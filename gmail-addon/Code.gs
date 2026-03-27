/**
 * Helions Forge — Gmail Add-on Quote Generator
 *
 * Script Properties required (Project Settings → Script Properties):
 *   ADDON_API_KEY  — matches GMAIL_ADDON_API_KEY on the server
 *   TENANT_ID      — Helions Forge tenant UUID
 *   API_BASE_URL   — e.g. https://quote-engine.helionsforge.com
 */

// =============================================================================
// CONSTANTS
// =============================================================================

var COMPLEXITY_MULTIPLIERS = {
  simple:    1.0,
  standard:  1.25,
  highly:    1.5,
  victorian: 2.0,
};

var CACHE_TTL = 600; // 10 minutes

// =============================================================================
// INFRASTRUCTURE HELPERS
// =============================================================================

function getProps_() {
  var p = PropertiesService.getScriptProperties();
  return {
    apiKey:   p.getProperty('ADDON_API_KEY')  || '',
    tenantId: p.getProperty('TENANT_ID')      || '',
    apiBase:  p.getProperty('API_BASE_URL')   || 'https://quote-engine.helionsforge.com',
  };
}

function apiPost_(path, payload) {
  var p = getProps_();
  var resp = UrlFetchApp.fetch(p.apiBase + path, {
    method:         'post',
    contentType:    'application/json',
    headers:        { Authorization: 'Bearer ' + p.apiKey },
    payload:        JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  return { code: resp.getResponseCode(), body: JSON.parse(resp.getContentText()) };
}

function cache_() { return CacheService.getUserCache(); }

function cacheGet_(key) {
  var v = cache_().get(key);
  try { return v ? JSON.parse(v) : null; } catch(e) { return v; }
}

function cacheSet_(key, value, ttl) {
  cache_().put(key, JSON.stringify(value), ttl || CACHE_TTL);
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

function fmt_(n) {
  return n ? Number(n).toLocaleString('en-GB') : '0';
}

function cap_(s) {
  return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '';
}

function confBadge_(c) {
  return c === 'high' ? '🟢 High' : c === 'medium' ? '🟡 Medium' : '🔴 Low';
}

function materialLabel_(v) {
  return v === 'aluminium' ? 'Aluminium' : 'Mild Steel';
}

function complexityLabel_(v) {
  var map = {
    simple:    'Simple flat bar (1.0×)',
    standard:  'Standard decorative (1.25×)',
    highly:    'Highly decorative (1.5×)',
    victorian: 'Victorian / ornate (2.0×)',
  };
  return map[v] || cap_(v);
}

function motorLabel_(v) {
  var map = { none: 'N/A', frog_x: 'Underground FROG-X', ftx_p: 'Articulated arm FTX-P', bxv: 'Sliding BXV' };
  return map[v] || v;
}

function accessLabel_(v) {
  var map = { none: 'None', fobs: 'Remote fobs only', keypad: 'Keypad', gsm_audio: 'GSM audio intercom', video: 'Video intercom' };
  return map[v] || v;
}

function installLabel_(v) {
  return v === 'concrete_in_posts' ? 'Concrete in posts' : 'Brick to brick';
}

function supplyLabel_(v) {
  return v === 'supply_only' ? 'Supply only' : 'Supply and install';
}

// Detect best-guess complexity key from an AI material string
function guessComplexity_(material) {
  if (!material) return 'standard';
  var m = material.toLowerCase();
  if (m.includes('victorian') || m.includes('ornate')) return 'victorian';
  if (m.includes('highly') || m.includes('elaborate')) return 'highly';
  if (m.includes('simple') || m.includes('flat')) return 'simple';
  return 'standard';
}

// =============================================================================
// THREAD HELPER
// =============================================================================

/**
 * Returns the combined text of the last N messages in the thread,
 * plus the total thread message count.
 */
function getThreadContext_(message, maxMessages) {
  var max = maxMessages || 5;
  try {
    var thread   = message.getThread();
    var all      = thread.getMessages();
    var recent   = all.slice(-max);
    var combined = recent.map(function(m, i) {
      return 'Email ' + (i + 1) + ' of ' + recent.length +
             ' (From: ' + (m.getFrom() || 'Unknown') + '):\n' +
             m.getPlainBody().slice(0, 1200);
    }).join('\n\n---\n\n');
    return { body: combined, count: all.length };
  } catch (e) {
    return { body: message.getPlainBody(), count: 1 };
  }
}

// =============================================================================
// ERROR CARDS
// =============================================================================

function errorCard_(msg) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Error'))
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph().setText('❌ ' + msg))
        .addWidget(
          CardService.newTextButton()
            .setText('← Back')
            .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
        )
    )
    .build();
}

function errorResponse_(msg) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(errorCard_(msg)))
    .build();
}

// Generic back-pop action
function onPopCard_(event) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popCard())
    .build();
}

// =============================================================================
// ENTRY POINTS
// =============================================================================

/** Home screen (no email open). */
function buildHomePage() {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Quote Generator'))
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText('Open a customer enquiry email in Gmail to generate a price estimate.'))
    )
    .build();
}

/**
 * Contextual trigger — fired whenever the user opens an email.
 * Shows email summary, any image attachments, and the Generate button.
 */
function buildContextualCard(event) {
  var messageId   = event.gmail.messageId;
  var accessToken = event.gmail.accessToken;

  try {
    GmailApp.setCurrentMessageAccessToken(accessToken);
    var message = GmailApp.getMessageById(messageId);
    var subject = message.getSubject() || '(no subject)';
    var from    = message.getFrom()    || '';

    // Detect image attachments (metadata only — no bytes fetched yet)
    var allAttachments   = message.getAttachments();
    var imageAttachments = allAttachments.filter(function(a) {
      return /^image\//i.test(a.getContentType());
    });

    var card = CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Quote Generator'));

    // ── Email summary ──────────────────────────────────────────────────────
    var infoSection = CardService.newCardSection();
    infoSection.addWidget(
      CardService.newKeyValue().setTopLabel('Subject').setContent(subject.slice(0, 80))
    );
    if (from) {
      infoSection.addWidget(
        CardService.newKeyValue().setTopLabel('From').setContent(from.slice(0, 60))
      );
    }
    card.addSection(infoSection);

    // ── Image attachments ──────────────────────────────────────────────────
    if (imageAttachments.length > 0) {
      var photoSection = CardService.newCardSection()
        .setHeader('📷 Attachments (' + imageAttachments.length + ')');

      imageAttachments.forEach(function(att, i) {
        var name = att.getName() || ('Image ' + (i + 1));
        photoSection.addWidget(
          CardService.newKeyValue()
            .setTopLabel('Attachment ' + (i + 1))
            .setContent(name.slice(0, 50))
            .setButton(
              CardService.newTextButton()
                .setText('Analyse')
                .setOnClickAction(
                  CardService.newAction()
                    .setFunctionName('onAnalysePhoto')
                    .setParameters({ messageId: messageId, idx: String(i) })
                )
            )
        );
      });
      card.addSection(photoSection);
    }

    // ── Generate button ────────────────────────────────────────────────────
    card.addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText('Tap below to analyse this email and generate a price estimate.'))
        .addWidget(
          CardService.newTextButton()
            .setText('⚡  Generate Estimate')
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onGenerateEstimate')
                .setParameters({ messageId: messageId })
            )
        )
    );

    return card.build();

  } catch (e) {
    return errorCard_('Could not load email: ' + e.message);
  }
}

// =============================================================================
// ACTION HANDLERS
// =============================================================================

/** Generate Estimate — reads thread, calls quote API, pushes result card. */
function onGenerateEstimate(event) {
  var messageId   = (event.parameters && event.parameters.messageId) || event.gmail.messageId;
  var accessToken = event.gmail.accessToken;

  try {
    var p = getProps_();
    if (!p.apiKey || !p.tenantId) {
      return errorResponse_('Script Properties not configured. Set ADDON_API_KEY, TENANT_ID, API_BASE_URL.');
    }

    GmailApp.setCurrentMessageAccessToken(accessToken);
    var message = GmailApp.getMessageById(messageId);
    var subject = message.getSubject() || '';

    // Thread-aware: combine last 5 messages
    var ctx         = getThreadContext_(message, 5);
    var threadBody  = ctx.body;
    var threadCount = ctx.count;

    var result = apiPost_('/api/gmail-addon/quote', {
      email_subject: subject,
      email_body:    threadBody,
      tenant_id:     p.tenantId,
    });

    if (result.code !== 200) {
      return errorResponse_('API error ' + result.code + ': ' + (result.body.error || 'Unknown'));
    }

    var q = result.body;

    // Persist state for downstream actions
    cacheSet_('quote',        q);
    cacheSet_('subject',      subject);
    cacheSet_('body',         threadBody);
    cacheSet_('messageId',    messageId);
    cacheSet_('threadCount',  threadCount);
    cache_().remove('assumptions');
    cache_().remove('suggestedComplexity');

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .updateCard(buildResultCard_(q, threadCount, messageId)))
      .build();

  } catch (e) {
    return errorResponse_('Unexpected error: ' + e.message);
  }
}

/** Open the assumptions form panel. */
function onShowAssumptions(event) {
  var q                  = cacheGet_('quote')              || {};
  var suggestedComplexity = cacheGet_('suggestedComplexity') || guessComplexity_(q.material);

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation()
      .pushCard(buildAssumptionsCard_(q, suggestedComplexity)))
    .build();
}

/**
 * Recalculate with the filled assumptions form.
 * event.formInput contains all SelectionInput / TextInput field values.
 */
function onRecalculate(event) {
  var f = event.formInput || {};

  var material    = f.material         || 'mild_steel';
  var complexity  = f.complexity       || 'standard';
  var gateType    = f.gate_type        || 'manual';
  var motorType   = f.motor_type       || 'none';
  var accessCtrl  = f.access_control   || 'none';
  var power       = f.power_available  || 'yes';
  var installType = f.install_type     || 'brick_to_brick';
  var supplyType  = f.supply_type      || 'supply_and_install';
  var notes       = f.notes            || '';

  var assumptions = [
    { label: 'Material',           value: materialLabel_(material)   },
    { label: 'Design complexity',  value: complexityLabel_(complexity) },
    { label: 'Gate type',          value: gateType === 'electric' ? 'Electric automated' : 'Manual' },
    { label: 'Installation type',  value: installLabel_(installType) },
    { label: 'Supply scope',       value: supplyLabel_(supplyType)   },
  ];

  if (gateType === 'electric') {
    assumptions.push({ label: 'Motor type',      value: motorLabel_(motorType)  });
    assumptions.push({ label: 'Access control',  value: accessLabel_(accessCtrl) });
    assumptions.push({ label: 'Power on site',   value: power === 'yes' ? 'Yes' : 'No – needs consumer unit connection' });
  }
  if (notes) {
    assumptions.push({ label: 'Additional notes', value: notes });
  }

  var multiplier  = COMPLEXITY_MULTIPLIERS[complexity] || 1.0;
  var subject     = cacheGet_('subject')    || '';
  var body        = cacheGet_('body')       || '';
  var threadCount = cacheGet_('threadCount') || 1;
  var messageId   = cacheGet_('messageId')  || '';
  var p           = getProps_();

  try {
    var result = apiPost_('/api/gmail-addon/quote', {
      email_subject:         subject,
      email_body:            body,
      tenant_id:             p.tenantId,
      complexity_multiplier: multiplier,
      assumptions:           assumptions,
    });

    if (result.code !== 200) {
      return errorResponse_('API error ' + result.code + ': ' + (result.body.error || 'Unknown'));
    }

    var q = result.body;
    q.assumptions = assumptions; // carry through for save

    cacheSet_('quote',       q);
    cacheSet_('assumptions', assumptions);

    // Pop assumptions card, update result card underneath
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .popCard()
        .updateCard(buildResultCard_(q, threadCount, messageId)))
      .build();

  } catch (e) {
    return errorResponse_('Recalculate failed: ' + e.message);
  }
}

/** Fetch image attachment, send to vision API, push analysis card. */
function onAnalysePhoto(event) {
  var messageId   = (event.parameters && event.parameters.messageId) || cacheGet_('messageId');
  var idx         = parseInt((event.parameters && event.parameters.idx) || '0', 10);
  var accessToken = event.gmail.accessToken;

  try {
    GmailApp.setCurrentMessageAccessToken(accessToken);
    var message     = GmailApp.getMessageById(messageId);
    var allAtt      = message.getAttachments();
    var imageAtt    = allAtt.filter(function(a) { return /^image\//i.test(a.getContentType()); });

    if (idx >= imageAtt.length) {
      return errorResponse_('Attachment not found.');
    }

    var att      = imageAtt[idx];
    var mimeType = att.getContentType();
    var base64   = Utilities.base64Encode(att.copyBlob().getBytes());

    var result = apiPost_('/api/gmail-addon/analyse-photo', {
      image_base64: base64,
      mime_type:    mimeType,
      tenant_id:    getProps_().tenantId,
    });

    if (result.code !== 200) {
      return errorResponse_('Photo analysis failed: ' + (result.body.error || 'Unknown'));
    }

    var analysis = result.body;
    cacheSet_('suggestedComplexity', analysis.complexity || 'standard');

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .pushCard(buildPhotoCard_(analysis, att.getName() || ('Image ' + (idx + 1)))))
      .build();

  } catch (e) {
    return errorResponse_('Photo analysis error: ' + e.message);
  }
}

/** Save enquiry + quote to dashboard (explicit user action). */
function onSaveEnquiry(event) {
  var q           = cacheGet_('quote');
  var subject     = cacheGet_('subject')     || '';
  var body        = cacheGet_('body')        || '';
  var assumptions = cacheGet_('assumptions') || (q && q.assumptions) || [];
  var p           = getProps_();

  if (!q) {
    return errorResponse_('No estimate found — please generate one first.');
  }

  try {
    var result = apiPost_('/api/gmail-addon/save', {
      tenant_id:        p.tenantId,
      email_subject:    subject,
      email_body:       body,
      price_low:        q.price_low,
      price_high:       q.price_high,
      confidence:       q.confidence,
      reasoning:        q.reasoning,
      product_type:     q.product_type,
      material:         q.material,
      assumptions:      assumptions,
      similar_quote_ids: q.similar_quote_ids || [],
    });

    if (result.code !== 200) {
      return errorResponse_('Save failed: ' + (result.body.error || 'Unknown'));
    }

    var saved = result.body;
    cacheSet_('savedEnquiryId', saved.enquiry_id);

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .pushCard(buildSavedCard_(saved.enquiry_id, p.apiBase)))
      .build();

  } catch (e) {
    return errorResponse_('Save error: ' + e.message);
  }
}

/**
 * Generate a reply draft at the chosen tone and save it to Drafts.
 * Tone is passed via action parameters: 'formal' | 'friendly' | 'quick'
 */
function onInsertReply(event) {
  var tone        = (event.parameters && event.parameters.tone) || 'friendly';
  var q           = cacheGet_('quote');
  var subject     = cacheGet_('subject')  || '';
  var body        = cacheGet_('body')     || '';
  var messageId   = cacheGet_('messageId');
  var accessToken = event.gmail.accessToken;

  if (!q) {
    return errorResponse_('No estimate found — please generate one first.');
  }

  try {
    var result = apiPost_('/api/gmail-addon/draft-reply', {
      email_subject: subject,
      email_body:    body,
      price_low:     q.price_low,
      price_high:    q.price_high,
      product_type:  q.product_type,
      material:      q.material,
      tone:          tone,
      quote_mode:    q.quote_mode || 'precise',
      missing_info:  q.missing_info || [],
    });

    if (result.code !== 200) {
      return errorResponse_('Draft reply error: ' + (result.body.error || 'Unknown'));
    }

    var draft = result.body;

    // Create a reply draft in the user's Drafts folder
    GmailApp.setCurrentMessageAccessToken(accessToken);
    var message = GmailApp.getMessageById(messageId);
    message.createReplyDraft(draft.body);

    var toneName = tone === 'formal' ? 'Formal' : tone === 'quick' ? 'Quick' : 'Friendly';

    var confirmCard = CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Draft Created'))
      .addSection(
        CardService.newCardSection()
          .addWidget(CardService.newTextParagraph()
            .setText('✅ ' + toneName + ' reply draft saved to your Drafts folder.'))
          .addWidget(CardService.newKeyValue()
            .setTopLabel('Subject').setContent(draft.subject))
          .addWidget(CardService.newTextParagraph()
            .setText('Open Gmail Drafts to review and send.'))
          .addWidget(
            CardService.newTextButton()
              .setText('← Back to Estimate')
              .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
          )
      )
      .build();

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(confirmCard))
      .build();

  } catch (e) {
    return errorResponse_('Reply draft failed: ' + e.message);
  }
}

// =============================================================================
// CARD BUILDERS
// =============================================================================

function buildResultCard_(q, threadCount, messageId) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Estimate Ready'));

  // ── Thread context banner ────────────────────────────────────────────────
  if (threadCount > 1) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText('ℹ️ Thread context: ' + threadCount + ' email' + (threadCount !== 1 ? 's' : '') + ' analysed'))
    );
  }

  // ── Mode indicator ───────────────────────────────────────────────────────
  var modeSection = CardService.newCardSection();
  if (q.quote_mode === 'rough') {
    modeSection
      .addWidget(CardService.newTextParagraph()
        .setText('📊 Rough estimate — provide details for accuracy'))
      .addWidget(
        CardService.newTextButton()
          .setText('➕  Add Details for Precise Estimate')
          .setOnClickAction(CardService.newAction().setFunctionName('onShowAssumptions'))
      );
  } else {
    modeSection.addWidget(
      CardService.newTextParagraph().setText('🎯 Precise estimate — based on confirmed specs')
    );
  }
  card.addSection(modeSection);

  // ── Price ────────────────────────────────────────────────────────────────
  var priceSection = CardService.newCardSection().setHeader('💰 Price Estimate');
  priceSection.addWidget(
    CardService.newKeyValue()
      .setTopLabel('Range (+ VAT)')
      .setContent('£' + fmt_(q.price_low) + ' – £' + fmt_(q.price_high))
  );
  priceSection.addWidget(
    CardService.newKeyValue()
      .setTopLabel('Confidence')
      .setContent(confBadge_(q.confidence))
  );
  if (q.product_type) {
    priceSection.addWidget(
      CardService.newKeyValue()
        .setTopLabel('Type')
        .setContent(q.product_type + (q.material ? ' · ' + q.material : ''))
    );
  }
  card.addSection(priceSection);

  // ── Reasoning (collapsible) ──────────────────────────────────────────────
  if (q.reasoning) {
    card.addSection(
      CardService.newCardSection()
        .setHeader('AI Reasoning')
        .setCollapsible(true)
        .setNumUncollapsibleWidgets(0)
        .addWidget(CardService.newTextParagraph().setText(q.reasoning))
    );
  }

  // ── Clarifying questions ─────────────────────────────────────────────────
  if (q.missing_info && q.missing_info.length > 0) {
    var qSection = CardService.newCardSection().setHeader('❓ Clarifying Questions');
    q.missing_info.forEach(function(item) {
      qSection.addWidget(CardService.newTextParagraph().setText('• ' + item));
    });
    card.addSection(qSection);
  }

  // ── Refine ───────────────────────────────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .setHeader('Refine')
      .addWidget(
        CardService.newTextButton()
          .setText('🔧  Edit Assumptions & Recalculate')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(CardService.newAction().setFunctionName('onShowAssumptions'))
      )
      .addWidget(
        CardService.newTextButton()
          .setText('🔄  Re-generate from Email')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onGenerateEstimate')
              .setParameters({ messageId: messageId || '' })
          )
      )
  );

  // ── Reply tones ──────────────────────────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .setHeader('Draft Reply')
      .addWidget(CardService.newTextParagraph().setText('Choose a tone:'))
      .addWidget(
        CardService.newTextButton()
          .setText('📋  Formal')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onInsertReply')
              .setParameters({ tone: 'formal' })
          )
      )
      .addWidget(
        CardService.newTextButton()
          .setText('😊  Friendly')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onInsertReply')
              .setParameters({ tone: 'friendly' })
          )
      )
      .addWidget(
        CardService.newTextButton()
          .setText('⚡  Quick')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onInsertReply')
              .setParameters({ tone: 'quick' })
          )
      )
  );

  // ── Save ─────────────────────────────────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newTextButton()
          .setText('💾  Save to Dashboard')
          .setOnClickAction(CardService.newAction().setFunctionName('onSaveEnquiry'))
      )
  );

  return card.build();
}

/**
 * Assumptions form panel.
 * suggestedComplexity: pre-selects the complexity dropdown (from photo analysis or AI guess).
 */
function buildAssumptionsCard_(existingResult, suggestedComplexity) {
  var mat       = (existingResult.material || '').toLowerCase();
  var isAlum    = mat.includes('alum');
  var defCmplx  = suggestedComplexity || guessComplexity_(existingResult.material) || 'standard';

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Confirm Assumptions'));

  // ── Materials & Design ───────────────────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .setHeader('Materials & Design')
      .addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.DROPDOWN)
          .setFieldName('material')
          .setTitle('Material')
          .addItem('Mild Steel',  'mild_steel',  !isAlum)
          .addItem('Aluminium',   'aluminium',   isAlum)
      )
      .addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.DROPDOWN)
          .setFieldName('complexity')
          .setTitle('Design Complexity')
          .addItem('Simple flat bar (1.0×)',        'simple',    defCmplx === 'simple')
          .addItem('Standard decorative (1.25×)',   'standard',  defCmplx === 'standard')
          .addItem('Highly decorative (1.5×)',      'highly',    defCmplx === 'highly')
          .addItem('Victorian / ornate (2.0×)',     'victorian', defCmplx === 'victorian')
      )
  );

  // ── Gate Configuration ───────────────────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .setHeader('Gate Configuration')
      .addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.DROPDOWN)
          .setFieldName('gate_type')
          .setTitle('Gate Type')
          .addItem('Manual',             'manual',   true)
          .addItem('Electric automated', 'electric', false)
      )
      .addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.DROPDOWN)
          .setFieldName('motor_type')
          .setTitle('Motor Type (if electric)')
          .addItem('N/A',                   'none',   true)
          .addItem('Underground FROG-X',    'frog_x', false)
          .addItem('Articulated arm FTX-P', 'ftx_p',  false)
          .addItem('Sliding BXV',           'bxv',    false)
      )
      .addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.DROPDOWN)
          .setFieldName('access_control')
          .setTitle('Access Control')
          .addItem('None',                  'none',      true)
          .addItem('Remote fobs only',      'fobs',      false)
          .addItem('Keypad',                'keypad',    false)
          .addItem('GSM audio intercom',    'gsm_audio', false)
          .addItem('Video intercom',        'video',     false)
      )
      .addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.DROPDOWN)
          .setFieldName('power_available')
          .setTitle('Power Available on Site')
          .addItem('Yes',                                   'yes', true)
          .addItem('No – needs consumer unit connection',   'no',  false)
      )
  );

  // ── Installation ─────────────────────────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .setHeader('Installation')
      .addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.DROPDOWN)
          .setFieldName('install_type')
          .setTitle('Installation Type')
          .addItem('Brick to brick',    'brick_to_brick',   true)
          .addItem('Concrete in posts', 'concrete_in_posts', false)
      )
      .addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.DROPDOWN)
          .setFieldName('supply_type')
          .setTitle('Scope')
          .addItem('Supply and install', 'supply_and_install', true)
          .addItem('Supply only',        'supply_only',         false)
      )
  );

  // ── Notes ────────────────────────────────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .setHeader('Additional Notes')
      .addWidget(
        CardService.newTextInput()
          .setFieldName('notes')
          .setTitle('Special requirements')
          .setHint('e.g. RAL 9005 powder coat, double leaf, existing posts to reuse')
          .setMultiline(true)
      )
  );

  // ── Actions ──────────────────────────────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newTextButton()
          .setText('🔁  Recalculate with Assumptions')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(CardService.newAction().setFunctionName('onRecalculate'))
      )
      .addWidget(
        CardService.newTextButton()
          .setText('← Back')
          .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
      )
  );

  return card.build();
}

/** Photo analysis result card. */
function buildPhotoCard_(analysis, fileName) {
  var cLabel = complexityLabel_(analysis.complexity || 'standard');

  var section = CardService.newCardSection().setHeader('📷 ' + fileName.slice(0, 40));

  section.addWidget(
    CardService.newKeyValue().setTopLabel('Suggested Complexity').setContent(cLabel)
  );
  section.addWidget(
    CardService.newKeyValue()
      .setTopLabel('Confidence')
      .setContent(confBadge_(analysis.confidence))
  );

  if (analysis.dimensions_noted && analysis.dimensions_noted !== 'None visible') {
    section.addWidget(
      CardService.newKeyValue().setTopLabel('Dimensions').setContent(analysis.dimensions_noted)
    );
  }

  if (analysis.design_features && analysis.design_features.length > 0) {
    section.addWidget(
      CardService.newTextParagraph()
        .setText('Features:\n' + analysis.design_features.map(function(f) { return '• ' + f; }).join('\n'))
    );
  }

  if (analysis.reasoning) {
    section.addWidget(CardService.newTextParagraph().setText(analysis.reasoning));
  }

  var actionSection = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph()
      .setText('Complexity pre-filled in Assumptions panel.'))
    .addWidget(
      CardService.newTextButton()
        .setText('🔧  Open Assumptions')
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(CardService.newAction().setFunctionName('onShowAssumptions'))
    )
    .addWidget(
      CardService.newTextButton()
        .setText('← Back')
        .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
    );

  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Photo Analysis'))
    .addSection(section)
    .addSection(actionSection)
    .build();
}

/** Confirmation card shown after saving to the dashboard. */
function buildSavedCard_(enquiryId, apiBase) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Saved'))
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText('✅ Enquiry and estimate saved to the dashboard.'))
        .addWidget(CardService.newKeyValue()
          .setTopLabel('Enquiry ID').setContent(enquiryId))
        .addWidget(
          CardService.newTextButton()
            .setText('📋  View in Dashboard')
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOpenLink(
              CardService.newOpenLink()
                .setUrl(apiBase + '/dashboard/enquiries/' + enquiryId)
                .setOpenAs(CardService.OpenAs.FULL_SIZE)
            )
        )
        .addWidget(
          CardService.newTextButton()
            .setText('← Back to Estimate')
            .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
        )
    )
    .build();
}
