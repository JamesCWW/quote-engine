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

function complexityLabel_(v) {
  var map = {
    simple:    'Simple flat bar (1.0×)',
    standard:  'Standard decorative (1.25×)',
    highly:    'Highly decorative (1.5×)',
    victorian: 'Victorian / ornate (2.0×)',
  };
  return map[v] || cap_(v);
}

function componentLabel_(c) {
  var labels = {
    aluminium_driveway_gates:    '🚪 Aluminium Driveway Gates',
    mild_steel_driveway_gates:   '🚪 Mild Steel Gates',
    iron_driveway_gates:         '🚪 Iron Driveway Gates',
    aluminium_pedestrian_gate:   '🚶 Aluminium Pedestrian Gate',
    mild_steel_pedestrian_gate:  '🚶 Mild Steel Pedestrian Gate',
    railings:                    '🔧 Railings',
    handrails:                   '🔧 Handrails',
    automation:                  '⚡ Automation',
    access_control:              '🔑 Access Control',
  };
  return labels[c] || cap_(String(c).replace(/_/g, ' '));
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
 * Shows email summary and action buttons.
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

    // ── Action buttons ─────────────────────────────────────────────────────
    card.addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText('Tap below to analyse this email and generate a price estimate.'))
        .addWidget(
          CardService.newTextButton()
            .setText('📋  Analyse Email')
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onAnalyseEmail')
                .setParameters({ messageId: messageId })
            )
        )
        .addWidget(
          CardService.newTextButton()
            .setText('✏️  Custom Description')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onShowCustomDescription')
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

/**
 * Analyse Email — reads thread, calls summarise API, shows Project Summary card.
 */
function onAnalyseEmail(event) {
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

    var ctx         = getThreadContext_(message, 5);
    var threadBody  = ctx.body;
    var threadCount = ctx.count;

    var result = apiPost_('/api/gmail-addon/summarise', {
      thread_text: subject ? ('Subject: ' + subject + '\n\n' + threadBody) : threadBody,
      tenant_id:   p.tenantId,
    });

    if (result.code !== 200) {
      return errorResponse_('Summarise error ' + result.code + ': ' + (result.body.error || 'Unknown'));
    }

    var summary    = result.body.summary            || '';
    var components = result.body.components_detected || [];

    // Cache context for downstream use
    cacheSet_('summary',      summary);
    cacheSet_('subject',      subject);
    cacheSet_('body',         threadBody);
    cacheSet_('messageId',    messageId);
    cacheSet_('threadCount',  threadCount);
    cache_().remove('emailContext');

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .pushCard(buildSummaryCard_(summary, components)))
      .build();

  } catch (e) {
    return errorResponse_('Analysis failed: ' + e.message);
  }
}

/**
 * Edit Summary — pushes the editable summary card so the user can refine in plain English.
 */
function onEditSummary(event) {
  var summary = cacheGet_('summary') || '';
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation()
      .pushCard(buildSummaryEditCard_(summary)))
    .build();
}

/**
 * Generate Estimate from summary — sends final summary text to quote API.
 * Called from both the read-only summary card (use_cached=true) and the edit card (form input).
 */
function onGenerateFromSummary(event) {
  var f           = event.formInput  || {};
  var useCached   = event.parameters && event.parameters.use_cached === 'true';
  var summaryText = useCached
    ? (cacheGet_('summary') || '')
    : ((f.summary_text || '').trim());

  var subject     = cacheGet_('subject')     || '';
  var threadBody  = cacheGet_('body')        || '';
  var threadCount = cacheGet_('threadCount') || 1;
  var messageId   = cacheGet_('messageId')   || '';
  var p           = getProps_();

  if (!summaryText) {
    return errorResponse_('No summary found — please go back and analyse the email first.');
  }
  if (!p.apiKey || !p.tenantId) {
    return errorResponse_('Script Properties not configured. Set ADDON_API_KEY, TENANT_ID, API_BASE_URL.');
  }

  // Persist edited summary so draft reply and result card can reference it
  if (!useCached) {
    cacheSet_('summary', summaryText);
  }

  try {
    // Pass the summary text directly as enquiry_text — no subject prefix.
    // This matches what the calibration tool does and avoids the subject
    // line confusing the extraction step.
    var result = apiPost_('/api/gmail-addon/quote', {
      email_body: summaryText,
      tenant_id:  p.tenantId,
    });

    if (result.code !== 200) {
      return errorResponse_('API error ' + result.code + ': ' + (result.body.error || 'Unknown'));
    }

    var q = result.body;

    cacheSet_('quote',       q);
    cacheSet_('emailContext', threadBody);
    cache_().remove('assumptions');
    cache_().remove('suggestedComplexity');
    if (q.job_components && q.job_components.length > 0) {
      cacheSet_('jobComponents', q.job_components);
    } else {
      cache_().remove('jobComponents');
    }

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .updateCard(buildResultCard_(q, threadCount, messageId, summaryText)))
      .build();

  } catch (e) {
    return errorResponse_('Unexpected error: ' + e.message);
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
  var q       = cacheGet_('quote');
  var subject = cacheGet_('subject') || '';
  var body    = cacheGet_('body')    || '';
  var summary = cacheGet_('summary') || '';
  var p       = getProps_();

  if (!q) {
    return errorResponse_('No estimate found — please generate one first.');
  }

  try {
    var savePayload = {
      tenant_id:         p.tenantId,
      email_subject:     subject,
      email_body:        body,
      price_low:         q.price_low,
      price_high:        q.price_high,
      confidence:        q.confidence,
      reasoning:         q.reasoning,
      product_type:      q.product_type,
      material:          q.material,
      assumptions:       summary ? [{ label: 'Project Summary', value: summary }] : [],
      missing_info:      q.missing_info      || [],
      similar_quote_ids: q.similar_quote_ids || [],
    };

    var result = apiPost_('/api/gmail-addon/save', savePayload);

    if (result.code !== 200) {
      return errorResponse_('Save failed (' + result.code + '): ' + JSON.stringify(result.body));
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

  var emailContext = cacheGet_('emailContext') || '';

  try {
    var draftPayload = {
      email_subject: subject,
      email_body:    body,
      price_low:     q.price_low,
      price_high:    q.price_high,
      product_type:  q.product_type,
      material:      q.material,
      tone:          tone,
      quote_mode:    q.quote_mode || 'precise',
      missing_info:  q.missing_info || [],
      components:    (q.components && q.components.length > 1) ? q.components : [],
    };
    if (emailContext) {
      draftPayload.email_context = emailContext;
    }
    var result = apiPost_('/api/gmail-addon/draft-reply', draftPayload);

    if (result.code !== 200) {
      return errorResponse_('Draft reply error: ' + (result.body.error || 'Unknown'));
    }

    var draft = result.body;

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

/** Show Custom Description card (price from custom text, draft reply uses email context). */
function onShowCustomDescription(event) {
  var messageId   = (event.parameters && event.parameters.messageId) || cacheGet_('messageId') || '';
  var accessToken = event.gmail.accessToken;

  try {
    GmailApp.setCurrentMessageAccessToken(accessToken);
    var message = GmailApp.getMessageById(messageId);
    var ctx     = getThreadContext_(message, 5);
    cacheSet_('pendingEmailContext', ctx.body);
    cacheSet_('pendingMessageId',    messageId);
    cacheSet_('pendingSubject',      message.getSubject() || '');
    cacheSet_('pendingThreadCount',  ctx.count);
  } catch (e) {
    // If we can't read the message, carry on
  }

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation()
      .pushCard(buildCustomDescriptionCard_()))
    .build();
}

/** Generate estimate from custom description text only. */
function onGenerateCustomEstimate(event) {
  var f               = event.formInput || {};
  var customText      = (f.custom_description || '').trim();
  var emailContext    = cacheGet_('pendingEmailContext') || '';
  var subject         = cacheGet_('pendingSubject')      || cacheGet_('subject') || '';
  var messageId       = cacheGet_('pendingMessageId')    || cacheGet_('messageId') || '';
  var threadCount     = cacheGet_('pendingThreadCount')  || 1;
  var p               = getProps_();

  if (!customText) {
    return errorResponse_('Please enter a description before generating.');
  }
  if (!p.apiKey || !p.tenantId) {
    return errorResponse_('Script Properties not configured. Set ADDON_API_KEY, TENANT_ID, API_BASE_URL.');
  }

  try {
    var result = apiPost_('/api/gmail-addon/quote', {
      email_body: customText,
      tenant_id:  p.tenantId,
    });

    if (result.code !== 200) {
      return errorResponse_('API error ' + result.code + ': ' + (result.body.error || 'Unknown'));
    }

    var q = result.body;

    cacheSet_('quote',        q);
    cacheSet_('subject',      subject);
    cacheSet_('body',         customText);
    cacheSet_('messageId',    messageId);
    cacheSet_('threadCount',  threadCount);
    cacheSet_('emailContext', emailContext);
    cacheSet_('summary',      customText);
    cache_().remove('assumptions');
    cache_().remove('suggestedComplexity');
    if (q.job_components && q.job_components.length > 0) {
      cacheSet_('jobComponents', q.job_components);
    } else {
      cache_().remove('jobComponents');
    }

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .popCard()
        .updateCard(buildResultCard_(q, threadCount, messageId, customText)))
      .build();

  } catch (e) {
    return errorResponse_('Unexpected error: ' + e.message);
  }
}

/**
 * Edit & Recalculate — pushes an editable card pre-filled with the
 * summary that produced the current estimate.
 */
function onEditAndRecalculate(event) {
  var summaryText = cacheGet_('summary') || '';
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation()
      .pushCard(buildRecalculateCard_(summaryText)))
    .build();
}

/**
 * Recalculate — re-runs the quote from the edited summary text
 * without re-analysing the email.
 */
function onRecalculate(event) {
  var f           = event.formInput || {};
  var summaryText = (f.recalc_summary || '').trim();
  var threadCount = cacheGet_('threadCount') || 1;
  var messageId   = cacheGet_('messageId')   || '';
  var p           = getProps_();

  if (!summaryText) {
    return errorResponse_('Summary text is empty — please enter a description.');
  }
  if (!p.apiKey || !p.tenantId) {
    return errorResponse_('Script Properties not configured. Set ADDON_API_KEY, TENANT_ID, API_BASE_URL.');
  }

  cacheSet_('summary', summaryText);

  try {
    var result = apiPost_('/api/gmail-addon/quote', {
      email_body: summaryText,
      tenant_id:  p.tenantId,
    });

    if (result.code !== 200) {
      return errorResponse_('API error ' + result.code + ': ' + (result.body.error || 'Unknown'));
    }

    var q = result.body;
    cacheSet_('quote', q);
    cache_().remove('assumptions');
    cache_().remove('suggestedComplexity');
    if (q.job_components && q.job_components.length > 0) {
      cacheSet_('jobComponents', q.job_components);
    } else {
      cache_().remove('jobComponents');
    }

    // Pop the recalculate card then update the result card underneath
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .popCard()
        .updateCard(buildResultCard_(q, threadCount, messageId, summaryText)))
      .build();

  } catch (e) {
    return errorResponse_('Unexpected error: ' + e.message);
  }
}

/** Generate email response from estimate and show in sidebar. */
function onGenerateEmailResponse(event) {
  var tone         = (event.parameters && event.parameters.tone) || 'friendly';
  var q            = cacheGet_('quote');
  var subject      = cacheGet_('subject')      || '';
  var body         = cacheGet_('body')         || '';
  var emailContext = cacheGet_('emailContext') || '';

  if (!q) {
    return errorResponse_('No estimate found — please generate one first.');
  }

  try {
    var draftPayload = {
      email_subject: subject,
      email_body:    body,
      price_low:     q.price_low,
      price_high:    q.price_high,
      product_type:  q.product_type,
      material:      q.material,
      tone:          tone,
      quote_mode:    q.quote_mode || 'precise',
      missing_info:  q.missing_info || [],
      components:    (q.components && q.components.length > 1) ? q.components : [],
      reasoning:     q.reasoning || '',
    };
    if (emailContext) draftPayload.email_context = emailContext;

    var result = apiPost_('/api/gmail-addon/draft-reply', draftPayload);

    if (result.code !== 200) {
      return errorResponse_('Email generation failed (' + result.code + '): ' + (result.body.error || JSON.stringify(result.body)));
    }

    var draft = result.body;
    cacheSet_('generatedEmailBody',    draft.body);
    cacheSet_('generatedEmailSubject', draft.subject);

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .pushCard(buildEmailCard_(draft.body, draft.subject, tone)))
      .build();

  } catch (e) {
    return errorResponse_('Email generation failed: ' + e.message);
  }
}

// =============================================================================
// PDF ESTIMATE
// =============================================================================

/** Parse "Name <email>" or bare email from a From header. */
function parseFrom_(from) {
  var match = from.match(/^(.*?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].trim().replace(/"/g, ''), email: match[2].trim() };
  }
  return { name: from.trim(), email: from.trim() };
}

/**
 * Show PDF confirmation card — auto-extracts customer from thread (first
 * message NOT from helionsforge.com) and shows an editable confirmation card.
 */
function onShowPdfForm(event) {
  var messageId   = (event.gmail && event.gmail.messageId) || cacheGet_('messageId');
  var accessToken = event.gmail && event.gmail.accessToken;
  var extracted   = { name: '', email: '' };

  if (messageId) {
    try {
      if (accessToken) GmailApp.setCurrentMessageAccessToken(accessToken);
      var message  = GmailApp.getMessageById(messageId);
      var thread   = message.getThread();
      var messages = thread.getMessages();
      // Find the first message NOT from Helions Forge
      var customerFrom = '';
      for (var i = 0; i < messages.length; i++) {
        var from = messages[i].getFrom() || '';
        if (from.indexOf('helionsforge.com') === -1) {
          customerFrom = from;
          break;
        }
      }
      if (customerFrom) extracted = parseFrom_(customerFrom);
    } catch (e) { /* fall through */ }
  }

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(
      buildPdfConfirmCard_(extracted.name, extracted.email)
    ))
    .build();
}

/** Generate PDF estimate and show download link. */
function onGeneratePdf(event) {
  var f            = event.formInput || {};
  var customerName = (f.pdf_customer_name || '').trim();
  var customerEmail = (f.pdf_customer_email || '').trim();
  var q            = cacheGet_('quote');
  var summary      = cacheGet_('summary') || '';
  var p            = getProps_();

  if (!customerName) {
    return errorResponse_('Please enter the customer name.');
  }
  if (!q) {
    return errorResponse_('No estimate found — please generate one first.');
  }

  try {
    var payload = {
      tenant_id:       p.tenantId,
      customer_name:   customerName,
      project_summary: summary || 'See estimate details.',
      price_low:       q.price_low,
      price_high:      q.price_high,
      breakdown:       q.det_breakdown || null,
      components:      q.components    || null,
      valid_days:      30,
    };
    if (customerEmail) payload.customer_email = customerEmail;

    var result = apiPost_('/api/estimates/pdf', payload);

    if (result.code !== 200) {
      return errorResponse_('PDF generation failed (' + result.code + '): ' + (result.body.error || 'Unknown error'));
    }

    var pdfUrl = result.body.url;
    var pdfRef = result.body.ref || 'Estimate';

    var card = CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('PDF Ready'))
      .addSection(
        CardService.newCardSection()
          .addWidget(CardService.newTextParagraph().setText('✅ PDF estimate created for ' + customerName + '.'))
          .addWidget(CardService.newKeyValue().setTopLabel('Reference').setContent(pdfRef))
          .addWidget(
            CardService.newTextButton()
              .setText('📥  Download / View PDF')
              .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
              .setOpenLink(
                CardService.newOpenLink()
                  .setUrl(pdfUrl)
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

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(card))
      .build();

  } catch (e) {
    return errorResponse_('PDF error: ' + e.message);
  }
}


/** Toast shown when Copy button is pressed (clipboard unavailable in add-ons). */
function onCopyEmailNotification(event) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification()
      .setText('Tap the text field above → Ctrl+A to select all → Ctrl+C to copy'))
    .build();
}

// =============================================================================
// CARD BUILDERS
// =============================================================================

/** Email preview card with tone selector and copyable text box. */
function buildEmailCard_(emailBody, emailSubject, activeTone) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Email Response'));

  // ── Tone buttons ─────────────────────────────────────────────────────────
  var toneSection = CardService.newCardSection().setHeader('Tone');
  [['formal', 'Formal'], ['friendly', 'Friendly'], ['quick', 'Quick']].forEach(function(pair) {
    var t = pair[0], label = pair[1];
    var btn = CardService.newTextButton()
      .setText(t === activeTone ? '✓ ' + label : label)
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onGenerateEmailResponse')
          .setParameters({ tone: t })
      );
    if (t === activeTone) btn.setTextButtonStyle(CardService.TextButtonStyle.FILLED);
    toneSection.addWidget(btn);
  });
  card.addSection(toneSection);

  // ── Email text (editable, selectable) ────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .setHeader(emailSubject || 'Reply')
      .addWidget(
        CardService.newTextInput()
          .setFieldName('email_text')
          .setTitle('Select all to copy')
          .setValue(emailBody || '')
          .setMultiline(true)
      )
  );

  // ── Actions ──────────────────────────────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newTextButton()
          .setText('📋  Copy to Clipboard')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(CardService.newAction().setFunctionName('onCopyEmailNotification'))
      )
      .addWidget(
        CardService.newTextButton()
          .setText('← Back to Estimate')
          .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
      )
  );

  return card.build();
}

/**
 * Project Summary card — shows AI-generated summary with components detected.
 * User can edit or proceed straight to estimate.
 */
function buildSummaryCard_(summary, components) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Project Summary'));

  // ── Summary text ──────────────────────────────────────────────────────────
  var summarySection = CardService.newCardSection().setHeader('📋 Project Summary');
  summarySection.addWidget(
    CardService.newTextParagraph().setText(summary || '(No summary generated)')
  );

  // ── Components detected ───────────────────────────────────────────────────
  if (components && components.length > 0) {
    var badges = components.map(function(c) { return componentLabel_(c); }).join('   ');
    summarySection.addWidget(
      CardService.newTextParagraph().setText(badges)
    );
  }
  card.addSection(summarySection);

  // ── Actions ───────────────────────────────────────────────────────────────
  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newTextButton()
          .setText('🎯  Generate Estimate')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onGenerateFromSummary')
              .setParameters({ use_cached: 'true' })
          )
      )
      .addWidget(
        CardService.newTextButton()
          .setText('✏️  Edit Summary')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onEditSummary')
          )
      )
      .addWidget(
        CardService.newTextButton()
          .setText('← Back')
          .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
      )
  );

  return card.build();
}

/** Editable summary card — lets the user refine the project description in plain English. */
function buildSummaryEditCard_(summary) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Edit Summary'))
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText('Edit the summary below to add or correct details, then tap Generate Estimate.'))
        .addWidget(
          CardService.newTextInput()
            .setFieldName('summary_text')
            .setTitle('Project summary')
            .setValue(summary || '')
            .setMultiline(true)
        )
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText('✅ Summary updated — ready to estimate'))
        .addWidget(
          CardService.newTextButton()
            .setText('🎯  Generate Estimate')
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onGenerateFromSummary')
            )
        )
        .addWidget(
          CardService.newTextButton()
            .setText('← Back')
            .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
        )
    )
    .build();
}

/** Edit & Recalculate card — pre-filled editable summary, Recalculate button. */
function buildRecalculateCard_(summaryText) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Edit & Recalculate'))
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText('Edit the project summary below to correct any details, then tap Recalculate.'))
        .addWidget(
          CardService.newTextInput()
            .setFieldName('recalc_summary')
            .setTitle('Project summary')
            .setValue(summaryText || '')
            .setMultiline(true)
        )
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextButton()
            .setText('🔄  Recalculate')
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOnClickAction(CardService.newAction().setFunctionName('onRecalculate'))
        )
        .addWidget(
          CardService.newTextButton()
            .setText('← Back')
            .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
        )
    )
    .build();
}

/** Result card — price estimate with breakdown and actions. */
function buildResultCard_(q, threadCount, messageId, summaryText) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Estimate Ready'));

  // ── Thread context banner ─────────────────────────────────────────────────
  if (threadCount > 1) {
    card.addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText('ℹ️ Thread context: ' + threadCount + ' email' + (threadCount !== 1 ? 's' : '') + ' analysed'))
    );
  }

  // ── 1. Price + confidence (prominent) ────────────────────────────────────
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
  if (q.quote_mode === 'rough') {
    priceSection.addWidget(
      CardService.newTextParagraph().setText('📊 Rough estimate — add details for accuracy')
    );
  }
  card.addSection(priceSection);

  // ── 2. Primary CTA: Generate Email + PDF + Edit & Recalculate ────────────
  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newTextButton()
          .setText('📧  Generate Email Response')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onGenerateEmailResponse')
              .setParameters({ tone: 'friendly' })
          )
      )
      .addWidget(
        CardService.newTextButton()
          .setText('📄  Generate PDF Estimate')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onShowPdfForm')
          )
      )
      .addWidget(
        CardService.newTextButton()
          .setText('✏️  Edit Summary & Recalculate')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onEditAndRecalculate')
          )
      )
  );

  // ── 3. AI Reasoning (collapsible, closed by default) ─────────────────────
  if (q.reasoning) {
    card.addSection(
      CardService.newCardSection()
        .setHeader('AI Reasoning')
        .setCollapsible(true)
        .setNumUncollapsibleWidgets(0)
        .addWidget(CardService.newTextParagraph().setText(q.reasoning))
    );
  }

  // ── 4. Clarifying Questions (collapsible, closed by default) ─────────────
  if (q.missing_info && q.missing_info.length > 0) {
    var qSection = CardService.newCardSection()
      .setHeader('❓ Clarifying Questions')
      .setCollapsible(true)
      .setNumUncollapsibleWidgets(0);
    q.missing_info.forEach(function(item) {
      qSection.addWidget(CardService.newTextParagraph().setText('• ' + item));
    });
    card.addSection(qSection);
  }

  // ── 5. Component Breakdown (collapsible, closed by default) ──────────────
  if (q.components && q.components.length > 1) {
    var compSection = CardService.newCardSection()
      .setHeader('📋 Component Breakdown')
      .setCollapsible(true)
      .setNumUncollapsibleWidgets(0);

    q.components.forEach(function(comp) {
      var icon = /gate|door/i.test(comp.name) ? '🚪' : '🔧';
      compSection.addWidget(
        CardService.newKeyValue()
          .setTopLabel(icon + ' ' + comp.name)
          .setContent('£' + fmt_(comp.subtotal_low) + ' – £' + fmt_(comp.subtotal_high))
      );
      if (comp.items && comp.items.length > 0) {
        var itemLines = comp.items.map(function(item) {
          return '  ' + item.label + ': £' + fmt_(item.amount) + (item.note ? ' (' + item.note + ')' : '');
        }).join('\n');
        compSection.addWidget(CardService.newTextParagraph().setText(itemLines));
      }
    });
    compSection.addWidget(CardService.newDivider());
    compSection.addWidget(
      CardService.newKeyValue()
        .setTopLabel('TOTAL ESTIMATE')
        .setContent('£' + fmt_(q.price_low) + ' – £' + fmt_(q.price_high) + ' + VAT')
    );
    card.addSection(compSection);
  }

  // ── 6. Alternative options ────────────────────────────────────────────────
  if (q.options && q.options.length > 1) {
    var optSection = CardService.newCardSection()
      .setHeader('🔀 Alternative Options');
    q.options.forEach(function(opt) {
      optSection.addWidget(
        CardService.newKeyValue()
          .setTopLabel(opt.name)
          .setContent('£' + fmt_(opt.price_low) + ' – £' + fmt_(opt.price_high) + ' + VAT')
      );
    });
    card.addSection(optSection);
  }

  // ── 7. Cost breakdown (collapsible) ─────────────────────────────────────
  if (q.det_breakdown) {
    var db = q.det_breakdown;
    var lines = ['Product supply: £' + fmt_(db.product_supply)];
    if (db.manufacture > 0) lines.push('Manufacture:    £' + fmt_(db.manufacture));
    if (db.installation > 0) lines.push('Installation:   £' + fmt_(db.installation));
    if (db.accessories && db.accessories.length > 0) {
      for (var i = 0; i < db.accessories.length; i++) {
        lines.push('  ' + db.accessories[i].name + ': £' + fmt_(db.accessories[i].amount));
      }
    }
    lines.push('──────────────────────');
    lines.push('Subtotal:       £' + fmt_(db.subtotal));
    lines.push('Contingency:    £' + fmt_(db.contingency) + ' (5%)');
    lines.push('──────────────────────');
    lines.push('ESTIMATE:       £' + fmt_(q.price_low) + ' – £' + fmt_(q.price_high));
    if (db.minimum_applied) lines.push('(floor raised to minimum: £' + fmt_(db.minimum_applied) + ')');
    if (db.job_type_matched) lines.push('Job type: ' + db.job_type_matched);

    card.addSection(
      CardService.newCardSection()
        .setHeader('Cost Breakdown')
        .setCollapsible(true)
        .setNumUncollapsibleWidgets(0)
        .addWidget(CardService.newTextParagraph().setText(lines.join('\n')))
    );
  } else if (q.cost_breakdown) {
    var cb = q.cost_breakdown;
    var cbLines = [
      'Materials:    £' + fmt_(cb.material_cost),
      'Manufacture:  £' + fmt_(cb.manufacture_cost) + ' (' + cb.manufacture_days + ' days × £507)',
      'Installation: £' + fmt_(cb.install_cost) + ' (' + cb.install_days + ' days × ' + cb.engineers + ' engineers × £523.84)',
      'Finishing:    £' + fmt_(cb.finishing_cost),
      '──────────────────────',
      'Subtotal:     £' + fmt_(cb.subtotal),
      'Contingency:  £' + fmt_(cb.contingency) + ' (5%)',
      '──────────────────────',
      'ESTIMATE:     £' + fmt_(q.price_low) + ' – £' + fmt_(q.price_high),
    ].join('\n');

    card.addSection(
      CardService.newCardSection()
        .setHeader('Cost Breakdown')
        .setCollapsible(true)
        .setNumUncollapsibleWidgets(0)
        .addWidget(CardService.newTextParagraph().setText(cbLines))
    );
  }

  // ── 8. Estimated from (collapsible, closed by default) ───────────────────
  if (summaryText) {
    card.addSection(
      CardService.newCardSection()
        .setHeader('📋 Estimated from')
        .setCollapsible(true)
        .setNumUncollapsibleWidgets(0)
        .addWidget(CardService.newTextParagraph().setText(summaryText))
    );
  }

  // ── 9. Save to Dashboard ──────────────────────────────────────────────────
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

/** Custom Description card — price from user's own words, draft reply uses email thread. */
function buildCustomDescriptionCard_() {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Custom Description'))
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph()
          .setText('Describe the job in your own words. Be as specific as you like — dimensions, materials, automation, finish etc.'))
        .addWidget(
          CardService.newTextInput()
            .setFieldName('custom_description')
            .setTitle('Job description')
            .setHint('e.g. Supply and install a pair of automated iron driveway gates, 4m wide x 1.8m tall, underground FROG-X motors, GSM intercom, powder coat RAL 9005, brick to brick')
            .setMultiline(true)
        )
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextButton()
            .setText('🎯  Generate Estimate')
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOnClickAction(CardService.newAction().setFunctionName('onGenerateCustomEstimate'))
        )
        .addWidget(
          CardService.newTextButton()
            .setText('↩️  Back')
            .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
        )
    )
    .build();
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
      .setText('Photo analysed — use this context when editing the project summary.'))
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

/**
 * PDF confirmation card — pre-filled editable TextInputs for name and email.
 * Extracted values are shown so the user can correct them before generating.
 */
function buildPdfConfirmCard_(name, email) {
  var nameInput = CardService.newTextInput()
    .setFieldName('pdf_customer_name')
    .setTitle('Name')
    .setHint('e.g. John Smith');
  if (name) nameInput.setValue(name);

  var emailInput = CardService.newTextInput()
    .setFieldName('pdf_customer_email')
    .setTitle('Email (optional)')
    .setHint('e.g. john@example.com');
  if (email) emailInput.setValue(email);

  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Generate PDF Estimate'))
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph().setText('Generating PDF for:'))
        .addWidget(nameInput)
        .addWidget(emailInput)
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextButton()
            .setText('📄  Generate PDF')
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOnClickAction(CardService.newAction().setFunctionName('onGeneratePdf'))
        )
        .addWidget(
          CardService.newTextButton()
            .setText('← Back')
            .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
        )
    )
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
