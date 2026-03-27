/**
 * Helions Forge — Gmail Add-on Quote Generator
 *
 * Script Properties required (set via Project Settings → Script Properties):
 *   ADDON_API_KEY  — matches GMAIL_ADDON_API_KEY on the server
 *   TENANT_ID      — your Helions Forge tenant UUID
 *   API_BASE_URL   — e.g. https://quote-engine.helionsforge.com
 */

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Shown when no email is open (e.g. add-on home screen). */
function buildHomePage() {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Helions Forge')
        .setSubtitle('Open an email to generate a quote estimate')
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(
          'Select a customer enquiry email and the quote generator will appear automatically.'
        )
      )
    )
    .build();
}

/** Called whenever an email is opened — builds the main sidebar card. */
function buildContextualCard(event) {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Helions Forge')
        .setSubtitle('Quote Generator')
    )
    .addSection(buildReadySection())
    .build();
}

// ---------------------------------------------------------------------------
// UI sections
// ---------------------------------------------------------------------------

function buildReadySection() {
  return CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText(
        'Click below to analyse this email and generate a price estimate.'
      )
    )
    .addWidget(
      CardService.newTextButton()
        .setText('⚡ Generate Estimate')
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(
          CardService.newAction().setFunctionName('onGenerateEstimate')
        )
    );
}

function buildLoadingCard() {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Generating estimate…')
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('⏳ Analysing email and building quote…')
      )
    )
    .build();
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/** Triggered when the "Generate Estimate" button is clicked. */
function onGenerateEstimate(event) {
  var messageId = event.gmail.messageId;
  var accessToken = event.gmail.accessToken;

  try {
    GmailApp.setCurrentMessageAccessToken(accessToken);
    var message = GmailApp.getMessageById(messageId);
    var subject = message.getSubject();
    var body = message.getPlainBody();

    var props = PropertiesService.getScriptProperties();
    var apiKey = props.getProperty('ADDON_API_KEY');
    var tenantId = props.getProperty('TENANT_ID');
    var apiBase = props.getProperty('API_BASE_URL') || 'https://quote-engine.helionsforge.com';

    if (!apiKey || !tenantId) {
      return showError('Script Properties not configured. See setup instructions.');
    }

    var response = UrlFetchApp.fetch(apiBase + '/api/gmail-addon/quote', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      payload: JSON.stringify({
        email_subject: subject,
        email_body: body,
        tenant_id: tenantId
      }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var result = JSON.parse(response.getContentText());

    if (code !== 200) {
      return showError('API error ' + code + ': ' + (result.error || 'Unknown error'));
    }

    // Store result in cache so the reply button can access it
    var cache = CacheService.getUserCache();
    cache.put('last_quote_result', JSON.stringify(result), 600); // 10 min TTL
    cache.put('last_email_subject', subject, 600);
    cache.put('last_email_body', body.slice(0, 3000), 600);

    return buildResultCard(result, messageId);

  } catch (e) {
    return showError('Unexpected error: ' + e.message);
  }
}

/** Triggered when the "Insert Reply" button is clicked. */
function onInsertReply(event) {
  try {
    var cache = CacheService.getUserCache();
    var cached = cache.get('last_quote_result');
    var subject = cache.get('last_email_subject') || '';
    var body = cache.get('last_email_body') || '';

    if (!cached) {
      return showError('Quote result expired. Please re-generate.');
    }

    var quoteResult = JSON.parse(cached);

    var props = PropertiesService.getScriptProperties();
    var apiKey = props.getProperty('ADDON_API_KEY');
    var apiBase = props.getProperty('API_BASE_URL') || 'https://quote-engine.helionsforge.com';

    var response = UrlFetchApp.fetch(apiBase + '/api/gmail-addon/draft-reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      payload: JSON.stringify({
        email_subject: subject,
        email_body: body,
        price_low: quoteResult.price_low,
        price_high: quoteResult.price_high,
        product_type: quoteResult.product_type,
        material: quoteResult.material
      }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var draft = JSON.parse(response.getContentText());

    if (code !== 200) {
      return showError('Draft API error ' + code + ': ' + (draft.error || 'Unknown error'));
    }

    // Insert a reply draft into the compose window
    var replyDraft = CardService.newComposeActionResponseBuilder()
      .setGmailDraft(
        GmailApp.createDraft(
          '', // To: left blank — user fills in from original thread
          draft.subject,
          draft.body
        )
      )
      .build();

    // Open compose window with pre-filled body
    return CardService.newActionResponseBuilder()
      .setComposeEmailAction(
        CardService.newComposeActionResponseBuilder()
          .setGmailDraft(
            GmailApp.createDraft('', draft.subject, draft.body)
          )
          .build(),
        CardService.ComposedEmailType.REPLY_AS_DRAFT
      )
      .build();

  } catch (e) {
    return showError('Failed to insert reply: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// Card builders
// ---------------------------------------------------------------------------

function buildResultCard(result, messageId) {
  var confidence = result.confidence || 'unknown';
  var confidenceEmoji = confidence === 'high' ? '🟢' : confidence === 'medium' ? '🟡' : '🔴';
  var priceLow = formatCurrency(result.price_low);
  var priceHigh = formatCurrency(result.price_high);

  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Helions Forge')
        .setSubtitle('Estimate Generated')
    );

  // Price range section
  var priceSection = CardService.newCardSection()
    .setHeader('Price Estimate')
    .addWidget(
      CardService.newKeyValue()
        .setTopLabel('Range')
        .setContent('£' + priceLow + ' – £' + priceHigh)
        .setBottomLabel('+ VAT')
    )
    .addWidget(
      CardService.newKeyValue()
        .setTopLabel('Confidence')
        .setContent(confidenceEmoji + ' ' + capitalise(confidence))
    );

  if (result.product_type) {
    priceSection.addWidget(
      CardService.newKeyValue()
        .setTopLabel('Product type')
        .setContent(result.product_type + (result.material ? ' / ' + result.material : ''))
    );
  }

  card.addSection(priceSection);

  // Reasoning section
  if (result.reasoning) {
    card.addSection(
      CardService.newCardSection()
        .setHeader('AI Reasoning')
        .setCollapsible(true)
        .addWidget(
          CardService.newTextParagraph().setText(result.reasoning)
        )
    );
  }

  // Clarifying questions (shown when confidence is low)
  if (result.missing_info && result.missing_info.length > 0) {
    var missingSection = CardService.newCardSection()
      .setHeader('🔴 Clarifying Questions Needed');

    result.missing_info.forEach(function (item) {
      missingSection.addWidget(
        CardService.newTextParagraph().setText('• ' + item)
      );
    });

    card.addSection(missingSection);
  }

  // Actions section
  var actionsSection = CardService.newCardSection()
    .addWidget(
      CardService.newTextButton()
        .setText('✉️ Insert Reply Draft')
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(
          CardService.newAction().setFunctionName('onInsertReply')
        )
    )
    .addWidget(
      CardService.newTextButton()
        .setText('🔄 Re-generate')
        .setOnClickAction(
          CardService.newAction().setFunctionName('onGenerateEstimate')
        )
    );

  if (result.enquiry_id) {
    var props = PropertiesService.getScriptProperties();
    var apiBase = props.getProperty('API_BASE_URL') || 'https://quote-engine.helionsforge.com';
    actionsSection.addWidget(
      CardService.newTextButton()
        .setText('📋 View in Dashboard')
        .setOpenLink(
          CardService.newOpenLink()
            .setUrl(apiBase + '/dashboard/enquiries/' + result.enquiry_id)
            .setOpenAs(CardService.OpenAs.FULL_SIZE)
        )
    );
  }

  card.addSection(actionsSection);

  return card.build();
}

function showError(message) {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Error')
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph().setText('❌ ' + message))
        .addWidget(
          CardService.newTextButton()
            .setText('Try Again')
            .setOnClickAction(
              CardService.newAction().setFunctionName('buildContextualCard')
            )
        )
    )
    .build();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value) {
  if (!value) return '0';
  return value.toLocaleString('en-GB');
}

function capitalise(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
