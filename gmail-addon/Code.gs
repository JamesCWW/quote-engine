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

// Detect product type category from a product_type string
function detectProductType_(productType) {
  if (!productType) return 'gates';
  var pt = String(productType).toLowerCase();
  if (pt.includes('railing') || pt.includes('balustrade')) return 'railings';
  if (pt.includes('handrail') || pt.includes('step')) return 'handrails';
  if (pt.includes('pedestrian')) return 'pedestrian_gates';
  return 'gates';
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
        .addWidget(
          CardService.newTextButton()
            .setText('📝  Custom Description')
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
    cache_().remove('emailContext');
    if (q.job_components && q.job_components.length > 0) {
      cacheSet_('jobComponents', q.job_components);
    } else {
      cache_().remove('jobComponents');
    }

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
 * Dispatches to product-type-specific logic.
 */
function onRecalculate(event) {
  var f = event.formInput || {};
  var q = cacheGet_('quote') || {};

  // Determine product type: form selector takes priority, then cached result
  var rawType     = f.product_type || (q.product_type || '');
  var productType = detectProductType_(rawType);

  var assumptions = [];
  var railingDims = null;

  // Mixed job: check for job_components in cache
  var cachedJobComponents = q.job_components || cacheGet_('jobComponents') || [];
  var isMixedJob = cachedJobComponents.length > 1 || f.mixed_job === 'true';

  if (isMixedJob) {
    // ── MIXED: gates + fencing/railings ─────────────────────────────────────
    var gateDesign     = f.gate_design       || '';
    var gateWidthMm    = f.gate_width_mm     || '';
    var gateHeightMm   = f.gate_height_mm    || '';
    var gateMaterial   = f.gate_material     || 'Aluminium';
    var gateTypeM      = f.gate_type         || 'electric';
    var motorTypeM     = f.motor_type        || 'none';
    var accessCtrlM    = f.access_control    || 'none';
    var postsRequired  = f.posts_required    || 'yes';
    var powerAvailM    = f.power_available   || 'yes';
    var gateFinish     = f.gate_finish       || '';

    var fenceLengthM   = parseFloat(f.fence_total_length_m || '0');
    var fenceType      = f.fence_type        || 'Steel railings to match gates';
    var fenceHeightM   = f.fence_height_m    || '';
    var fenceEndPosts  = f.fence_end_posts   || 'yes';
    var fenceMidPosts  = f.fence_mid_posts   || 'yes';
    var fenceFixing    = f.fence_fixing_method || '';
    var fenceFinish    = f.fence_finish      || '';

    assumptions = [
      { label: 'COMPONENT 1 — Gates',      value: '' },
      { label: 'Gate design',              value: gateDesign },
      { label: 'Gate width (mm)',          value: gateWidthMm },
      { label: 'Gate height (mm)',         value: gateHeightMm },
      { label: 'Gate material',            value: gateMaterial },
      { label: 'Automation',              value: gateTypeM === 'electric' ? 'Electric' : 'Manual' },
      { label: 'Motor type',               value: motorLabel_(motorTypeM) },
      { label: 'Access control',           value: accessLabel_(accessCtrlM) },
      { label: 'Posts required',           value: postsRequired === 'yes' ? 'Yes' : 'No' },
      { label: 'Power on site',           value: powerAvailM === 'yes' ? 'Yes' : 'No – needs consumer unit connection' },
      { label: 'Gate finish',              value: gateFinish },
      { label: 'COMPONENT 2 — Fencing',   value: '' },
      { label: 'Fencing total length (m)', value: fenceLengthM > 0 ? String(fenceLengthM) : '' },
      { label: 'Fencing type',             value: fenceType },
      { label: 'Fencing height (m)',       value: fenceHeightM },
      { label: 'End posts required',       value: fenceEndPosts === 'yes' ? 'Yes' : 'No' },
      { label: 'Mid-span posts required',  value: fenceMidPosts === 'yes' ? 'Yes' : 'No' },
      { label: 'Fence fixing method',      value: fenceFixing },
      { label: 'Fence finish',             value: fenceFinish },
    ].filter(function(a) { return a.value; });

  } else if (productType === 'railings') {
    var totalLength    = parseFloat(f.total_length_m          || '0');
    var height         = parseFloat(f.height_m                || '1.0');
    var postSpacing    = parseFloat(f.post_spacing_m          || '2.5');
    var barSpacing     = parseFloat(f.upright_bar_spacing_mm  || '112');
    var uprightSize    = f.upright_bar_size    || '10mm square';
    var topRail        = f.top_rail_section    || '40x10mm flat bar';
    var bottomRail     = f.bottom_rail_section || '40x10mm flat bar';
    var postSize       = f.post_size           || 'SHS 40x40x4mm';
    var fixingMethod   = f.fixing_method       || 'Core drilled into ground';
    var designStyle    = f.design_style        || 'vertical bars';
    var finish         = f.finish              || 'Primer + paint';
    var supplyTypeR    = f.supply_type         || 'supply_and_install';

    railingDims = {
      total_length_m:         totalLength,
      height_m:               height,
      upright_bar_size:       uprightSize,
      top_rail_section:       topRail,
      bottom_rail_section:    bottomRail,
      post_size:              postSize,
      post_spacing_m:         postSpacing,
      upright_bar_spacing_mm: barSpacing,
      design_style:           designStyle,
      finish:                 finish,
    };

    assumptions = [
      { label: 'Product Type',            value: 'Railings' },
      { label: 'Total length (m)',         value: String(totalLength) },
      { label: 'Height (m)',               value: String(height) },
      { label: 'Upright bar size',         value: uprightSize },
      { label: 'Top rail section',         value: topRail },
      { label: 'Bottom rail section',      value: bottomRail },
      { label: 'Post size',               value: postSize },
      { label: 'Post spacing (m)',         value: String(postSpacing) },
      { label: 'Bar spacing (mm)',         value: String(barSpacing) },
      { label: 'Fixing method',           value: fixingMethod },
      { label: 'Design style',            value: designStyle },
      { label: 'Finish',                  value: finish },
      { label: 'Supply scope',            value: supplyLabel_(supplyTypeR) },
    ].filter(function(a) { return a.value && a.value !== '0'; });

  } else if (productType === 'pedestrian_gates') {
    assumptions = [
      { label: 'Product Type',    value: 'Pedestrian Gate' },
      { label: 'Width (mm)',      value: f.gate_width_mm   || '' },
      { label: 'Height (mm)',     value: f.gate_height_mm  || '' },
      { label: 'Material',        value: f.gate_material   || 'Mild Steel' },
      { label: 'Design style',    value: f.gate_design     || '' },
      { label: 'Hinge side',      value: f.hinge_side      || '' },
      { label: 'Lock type',       value: f.lock_type       || '' },
      { label: 'Post type',       value: f.post_type       || '' },
      { label: 'Finish',          value: f.finish          || '' },
    ].filter(function(a) { return a.value; });

  } else if (productType === 'handrails') {
    assumptions = [
      { label: 'Product Type',        value: 'Handrails / Steps' },
      { label: 'Number of steps',     value: f.num_steps       || '' },
      { label: 'Total length (m)',    value: f.total_length_m  || '' },
      { label: 'Rail height (mm)',    value: f.rail_height_mm  || '900' },
      { label: 'Style',               value: f.handrail_style  || '' },
      { label: 'Fixing method',       value: f.fixing_method   || '' },
      { label: 'Finish',              value: f.finish          || '' },
    ].filter(function(a) { return a.value; });

  } else {
    // Gates (default) — original logic
    var material    = f.material         || 'mild_steel';
    var complexity  = f.complexity       || 'standard';
    var gateType    = f.gate_type        || 'manual';
    var motorType   = f.motor_type       || 'none';
    var accessCtrl  = f.access_control   || 'none';
    var power       = f.power_available  || 'yes';
    var installType = f.install_type     || 'brick_to_brick';
    var supplyType  = f.supply_type      || 'supply_and_install';
    var notes       = f.notes           || '';

    assumptions = [
      { label: 'Material',           value: materialLabel_(material)    },
      { label: 'Design complexity',  value: complexityLabel_(complexity) },
      { label: 'Gate type',          value: gateType === 'electric' ? 'Electric automated' : 'Manual' },
      { label: 'Installation type',  value: installLabel_(installType)  },
      { label: 'Supply scope',       value: supplyLabel_(supplyType)    },
    ];

    if (gateType === 'electric') {
      assumptions.push({ label: 'Motor type',     value: motorLabel_(motorType)   });
      assumptions.push({ label: 'Access control', value: accessLabel_(accessCtrl) });
      assumptions.push({ label: 'Power on site',  value: power === 'yes' ? 'Yes' : 'No – needs consumer unit connection' });
    }
    if (notes) {
      assumptions.push({ label: 'Additional notes', value: notes });
    }
  }

  var multiplier  = COMPLEXITY_MULTIPLIERS[f.complexity] || 1.0;
  var subject     = cacheGet_('subject')     || '';
  var body        = cacheGet_('body')        || '';
  var threadCount = cacheGet_('threadCount') || 1;
  var messageId   = cacheGet_('messageId')   || '';
  var p           = getProps_();

  try {
    var payload = {
      email_subject:         subject,
      email_body:            body,
      tenant_id:             p.tenantId,
      complexity_multiplier: multiplier,
      assumptions:           assumptions,
    };

    if (railingDims && railingDims.total_length_m > 0) {
      payload.railing_dims = railingDims;
    }

    var result = apiPost_('/api/gmail-addon/quote', payload);

    if (result.code !== 200) {
      return errorResponse_('API error ' + result.code + ': ' + (result.body.error || 'Unknown'));
    }

    var qResult = result.body;
    qResult.assumptions = assumptions;

    cacheSet_('quote',       qResult);
    cacheSet_('assumptions', assumptions);

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .popCard()
        .updateCard(buildResultCard_(qResult, threadCount, messageId)))
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

  Logger.log('onSaveEnquiry: subject=' + subject + ' price=' + q.price_low + '-' + q.price_high);

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
      assumptions:       assumptions,
      missing_info:      q.missing_info || [],
      similar_quote_ids: q.similar_quote_ids || [],
    };

    Logger.log('onSaveEnquiry: payload=' + JSON.stringify(savePayload));

    var result = apiPost_('/api/gmail-addon/save', savePayload);

    Logger.log('onSaveEnquiry: code=' + result.code + ' body=' + JSON.stringify(result.body));

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
    Logger.log('onSaveEnquiry: exception=' + e.message);
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

/** Show Add Details card (refine existing estimate with free-text). */
function onShowAddDetails(event) {
  var messageId = (event.parameters && event.parameters.messageId) || cacheGet_('messageId') || '';
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation()
      .pushCard(buildAddDetailsCard_(messageId)))
    .build();
}

/** Regenerate estimate after appending user-supplied additional details. */
function onRegenerateWithDetails(event) {
  var f           = event.formInput || {};
  var extraText   = (f.add_details_text || '').trim();
  var body        = cacheGet_('body')        || '';
  var subject     = cacheGet_('subject')     || '';
  var threadCount = cacheGet_('threadCount') || 1;
  var messageId   = cacheGet_('messageId')   || '';
  var p           = getProps_();

  if (!extraText) {
    return errorResponse_('Please enter some details before regenerating.');
  }

  var combined = body + '\n\nAdditional details/assumptions:\n' + extraText;

  try {
    var result = apiPost_('/api/gmail-addon/quote', {
      email_subject: subject,
      email_body:    combined,
      tenant_id:     p.tenantId,
    });

    if (result.code !== 200) {
      return errorResponse_('API error ' + result.code + ': ' + (result.body.error || 'Unknown'));
    }

    var q = result.body;
    cacheSet_('quote',    q);
    cacheSet_('body',     combined);
    cache_().remove('assumptions');
    if (q.job_components && q.job_components.length > 0) {
      cacheSet_('jobComponents', q.job_components);
    } else {
      cache_().remove('jobComponents');
    }

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation()
        .popCard()
        .updateCard(buildResultCard_(q, threadCount, messageId)))
      .setNotification(CardService.newNotification().setText('✅ Estimate updated with your details'))
      .build();

  } catch (e) {
    return errorResponse_('Regenerate failed: ' + e.message);
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
    // Stash the original email thread so draft reply can use it for tone/greeting
    cacheSet_('pendingEmailContext', ctx.body);
    cacheSet_('pendingMessageId',    messageId);
    cacheSet_('pendingSubject',      message.getSubject() || '');
    cacheSet_('pendingThreadCount',  ctx.count);
  } catch (e) {
    // If we can't read the message, carry on — draft reply just won't have email context
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
      email_subject: subject,
      email_body:    customText,
      tenant_id:     p.tenantId,
    });

    if (result.code !== 200) {
      return errorResponse_('API error ' + result.code + ': ' + (result.body.error || 'Unknown'));
    }

    var q = result.body;

    // Persist state — body is the custom description for recalculate,
    // emailContext is stashed separately for draft reply personalisation
    cacheSet_('quote',        q);
    cacheSet_('subject',      subject);
    cacheSet_('body',         customText);
    cacheSet_('messageId',    messageId);
    cacheSet_('threadCount',  threadCount);
    cacheSet_('emailContext', emailContext);
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
        .updateCard(buildResultCard_(q, threadCount, messageId)))
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

/** Toast shown when Copy button is pressed (clipboard unavailable in add-ons). */
function onCopyEmailNotification(event) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification()
      .setText('Tap the text field above → Ctrl+A to select all → Ctrl+C to copy'))
    .build();
}

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

  // ── 2. Primary CTA: Generate Email ───────────────────────────────────────
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
  );

  // ── 3. Secondary: Add Details ────────────────────────────────────────────
  var detailsSection = CardService.newCardSection();
  if (q.quote_mode === 'rough') {
    detailsSection.addWidget(
      CardService.newTextButton()
        .setText('➕  Add Details for Precise Estimate')
        .setOnClickAction(CardService.newAction().setFunctionName('onShowAssumptions'))
    );
  } else {
    detailsSection.addWidget(
      CardService.newTextButton()
        .setText('🔧  Edit Assumptions & Recalculate')
        .setOnClickAction(CardService.newAction().setFunctionName('onShowAssumptions'))
    );
  }
  detailsSection.addWidget(
    CardService.newTextButton()
      .setText('✏️  Add Details')
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onShowAddDetails')
          .setParameters({ messageId: messageId || '' })
      )
  );
  card.addSection(detailsSection);

  // ── 4. AI Reasoning (collapsible, closed by default) ─────────────────────
  if (q.reasoning) {
    card.addSection(
      CardService.newCardSection()
        .setHeader('AI Reasoning')
        .setCollapsible(true)
        .setNumUncollapsibleWidgets(0)
        .addWidget(CardService.newTextParagraph().setText(q.reasoning))
    );
  }

  // ── 5. Clarifying Questions (collapsible, closed by default) ─────────────
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

  // ── 6. Component Breakdown (collapsible, closed by default) ──────────────
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

  // ── Alternative options ──────────────────────────────────────────────────
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

  // ── Cost breakdown (collapsible — precise railing estimates only) ─────────
  if (q.cost_breakdown && !(q.components && q.components.length > 1)) {
    var cb = q.cost_breakdown;
    var lines = [
      'Materials:    £' + fmt_(cb.material_cost),
      'Manufacture:  £' + fmt_(cb.manufacture_cost) + ' (' + cb.manufacture_days + ' days × £507)',
      'Installation: £' + fmt_(cb.install_cost) + ' (' + cb.install_days + ' days × ' + cb.engineers + ' engineers × £523.84)',
      'Finishing:    £' + fmt_(cb.finishing_cost),
      '──────────────────────',
      'Subtotal:     £' + fmt_(cb.subtotal),
      'Contingency:  £' + fmt_(cb.contingency) + ' (10%)',
      '──────────────────────',
      'ESTIMATE:     £' + fmt_(q.price_low) + ' – £' + fmt_(q.price_high),
    ].join('\n');

    card.addSection(
      CardService.newCardSection()
        .setHeader('Cost Breakdown')
        .setCollapsible(true)
        .setNumUncollapsibleWidgets(0)
        .addWidget(CardService.newTextParagraph().setText(lines))
    );
  }

  // ── 7. Save to Dashboard ─────────────────────────────────────────────────
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
 * Assumptions form panel — dispatches to product-type-specific builder.
 */
function buildAssumptionsCard_(existingResult, suggestedComplexity) {
  // Mixed job: has multiple job_components (e.g. gates + railings)
  var jobComponents = existingResult.job_components || cacheGet_('jobComponents') || [];
  if (jobComponents.length > 1) {
    return buildMixedAssumptionsCard_(existingResult, jobComponents, suggestedComplexity);
  }
  var productType = detectProductType_(existingResult.product_type);
  if (productType === 'railings')        return buildRailingsAssumptionsCard_(existingResult);
  if (productType === 'pedestrian_gates') return buildPedestrianGatesAssumptionsCard_(existingResult);
  if (productType === 'handrails')       return buildHandrailsAssumptionsCard_(existingResult);
  return buildGatesAssumptionsCard_(existingResult, suggestedComplexity);
}

// ── Shared action footer ────────────────────────────────────────────────────
function addFormActions_(card) {
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
  return card;
}

// ── Shared finish dropdown ──────────────────────────────────────────────────
function addFinishDropdown_(section) {
  section.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('finish')
      .setTitle('Finish')
      .addItem('Primer + paint',            'Primer + paint',            true)
      .addItem('Hot dip galvanised',         'Hot dip galvanised',         false)
      .addItem('Galvanised + powder coat',   'Galvanised + powder coat',   false)
      .addItem('Powder coat only',           'Powder coat only',           false)
  );
  return section;
}

// ── RAILINGS assumptions card ───────────────────────────────────────────────
function buildRailingsAssumptionsCard_(existingResult) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Railing Details'));

  // Dimensions
  var dimSection = CardService.newCardSection().setHeader('Dimensions');
  dimSection.addWidget(
    CardService.newTextInput().setFieldName('total_length_m').setTitle('Total length (metres)')
      .setHint('e.g. 12.5')
  );
  dimSection.addWidget(
    CardService.newTextInput().setFieldName('height_m').setTitle('Height (metres)')
      .setHint('e.g. 1.1')
  );
  card.addSection(dimSection);

  // Sections
  var secSection = CardService.newCardSection().setHeader('Steel Sections');
  secSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('upright_bar_size').setTitle('Upright bar size')
      .addItem('10mm square', '10mm square', true)
      .addItem('12mm square', '12mm square', false)
      .addItem('14mm square', '14mm square', false)
      .addItem('16mm square', '16mm square', false)
      .addItem('20mm square', '20mm square', false)
      .addItem('25mm square', '25mm square', false)
  );
  secSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('top_rail_section').setTitle('Top rail section')
      .addItem('40x10mm flat bar',  '40x10mm flat bar',  true)
      .addItem('50x10mm flat bar',  '50x10mm flat bar',  false)
      .addItem('30x6mm flat bar',   '30x6mm flat bar',   false)
      .addItem('SHS 40x40x4mm',     'SHS 40x40x4mm',     false)
  );
  secSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('bottom_rail_section').setTitle('Bottom rail section')
      .addItem('40x10mm flat bar',  '40x10mm flat bar',  true)
      .addItem('50x10mm flat bar',  '50x10mm flat bar',  false)
      .addItem('30x6mm flat bar',   '30x6mm flat bar',   false)
      .addItem('SHS 40x40x4mm',     'SHS 40x40x4mm',     false)
  );
  secSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('post_size').setTitle('Post size')
      .addItem('SHS 40x40x4mm',   'SHS 40x40x4mm',   true)
      .addItem('SHS 50x50x3mm',   'SHS 50x50x3mm',   false)
      .addItem('SHS 60x60x5mm',   'SHS 60x60x5mm',   false)
      .addItem('SHS 80x80x6mm',   'SHS 80x80x6mm',   false)
      .addItem('SHS 100x100x6mm', 'SHS 100x100x6mm', false)
  );
  card.addSection(secSection);

  // Spacing & fixing
  var spacingSection = CardService.newCardSection().setHeader('Spacing & Fixing');
  spacingSection.addWidget(
    CardService.newTextInput().setFieldName('post_spacing_m').setTitle('Post spacing (metres)')
      .setHint('Default: 2.5').setValue('2.5')
  );
  spacingSection.addWidget(
    CardService.newTextInput().setFieldName('upright_bar_spacing_mm').setTitle('Upright bar spacing (mm)')
      .setHint('Default: 112').setValue('112')
  );
  spacingSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('fixing_method').setTitle('Fixing method')
      .addItem('Core drilled into ground', 'Core drilled into ground', true)
      .addItem('Bolt down plate',           'Bolt down plate',          false)
      .addItem('Welded to existing',        'Welded to existing',       false)
      .addItem('Wall mounted',              'Wall mounted',             false)
  );
  card.addSection(spacingSection);

  // Design & finish
  var designSection = CardService.newCardSection().setHeader('Design & Finish');
  designSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('design_style').setTitle('Design style')
      .addItem('Vertical bars',             'vertical bars',             true)
      .addItem('Vertical with top detail',  'vertical with top detail',  false)
      .addItem('Decorative with infill',    'decorative with infill',    false)
      .addItem('Heritage traditional',      'heritage traditional',      false)
  );
  addFinishDropdown_(designSection);
  designSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('supply_type').setTitle('Scope')
      .addItem('Supply and install', 'supply_and_install', true)
      .addItem('Supply only',        'supply_only',        false)
  );
  card.addSection(designSection);

  return addFormActions_(card).build();
}

// ── PEDESTRIAN GATES assumptions card ──────────────────────────────────────
function buildPedestrianGatesAssumptionsCard_(existingResult) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Pedestrian Gate Details'));

  var dimSection = CardService.newCardSection().setHeader('Dimensions');
  dimSection.addWidget(
    CardService.newTextInput().setFieldName('gate_width_mm').setTitle('Width (mm)').setHint('e.g. 900')
  );
  dimSection.addWidget(
    CardService.newTextInput().setFieldName('gate_height_mm').setTitle('Height (mm)').setHint('e.g. 1800')
  );
  card.addSection(dimSection);

  var specSection = CardService.newCardSection().setHeader('Specification');
  specSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('gate_material').setTitle('Material')
      .addItem('Mild Steel', 'Mild Steel', true)
      .addItem('Aluminium',  'Aluminium',  false)
  );
  specSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('gate_design').setTitle('Design style')
      .addItem('Simple flat bar',       'Simple flat bar',       true)
      .addItem('Standard decorative',   'Standard decorative',   false)
      .addItem('Highly decorative',     'Highly decorative',     false)
  );
  specSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('hinge_side').setTitle('Hinge side')
      .addItem('Left',   'Left',   true)
      .addItem('Right',  'Right',  false)
      .addItem('Either', 'Either', false)
  );
  specSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('lock_type').setTitle('Lock type')
      .addItem('Simple latch',         'Simple latch',         true)
      .addItem('Lockable drop bolt',   'Lockable drop bolt',   false)
      .addItem('Digital keypad lock',  'Digital keypad lock',  false)
  );
  specSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('post_type').setTitle('Post type')
      .addItem('Brick to brick',    'Brick to brick',    true)
      .addItem('Concrete in posts', 'Concrete in posts', false)
      .addItem('Bolt down posts',   'Bolt down posts',   false)
  );
  addFinishDropdown_(specSection);
  card.addSection(specSection);

  return addFormActions_(card).build();
}

// ── HANDRAILS / STEPS assumptions card ─────────────────────────────────────
function buildHandrailsAssumptionsCard_(existingResult) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Handrail / Steps Details'));

  var dimSection = CardService.newCardSection().setHeader('Dimensions');
  dimSection.addWidget(
    CardService.newTextInput().setFieldName('num_steps').setTitle('Number of steps').setHint('e.g. 4')
  );
  dimSection.addWidget(
    CardService.newTextInput().setFieldName('total_length_m').setTitle('Total length (metres)').setHint('e.g. 3.0')
  );
  dimSection.addWidget(
    CardService.newTextInput().setFieldName('rail_height_mm').setTitle('Rail height (mm)')
      .setHint('Default: 900').setValue('900')
  );
  card.addSection(dimSection);

  var designSection = CardService.newCardSection().setHeader('Design & Fixing');
  designSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('handrail_style').setTitle('Style')
      .addItem('Simple tube rail',          'Simple tube rail',          true)
      .addItem('Flat bar with uprights',    'Flat bar with uprights',    false)
      .addItem('Decorative with scroll',    'Decorative with scroll',    false)
  );
  designSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('fixing_method').setTitle('Fixing method')
      .addItem('Wall mounted',              'Wall mounted',              true)
      .addItem('Post fixed',                'Post fixed',                false)
      .addItem('Core drilled into ground',  'Core drilled into ground',  false)
  );
  addFinishDropdown_(designSection);
  card.addSection(designSection);

  return addFormActions_(card).build();
}

// ── GATES assumptions card (original, default) ──────────────────────────────
function buildGatesAssumptionsCard_(existingResult, suggestedComplexity) {
  var mat       = (existingResult.material || '').toLowerCase();
  var isAlum    = mat.includes('alum');
  var defCmplx  = suggestedComplexity || guessComplexity_(existingResult.material) || 'standard';

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Confirm Assumptions'));

  // Product type selector (shown when type is unclear)
  card.addSection(
    CardService.newCardSection()
      .setHeader('Product Type')
      .addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.DROPDOWN)
          .setFieldName('product_type')
          .setTitle('Product type')
          .addItem('Driveway / Pedestrian Gates', 'gates',           true)
          .addItem('Railings / Balustrade',       'railings',        false)
          .addItem('Pedestrian Gates',            'pedestrian_gates',false)
          .addItem('Handrails / Steps',           'handrails',       false)
      )
  );

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
          .addItem('Brick to brick',    'brick_to_brick',    true)
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

  return addFormActions_(card).build();
}

// ── MIXED JOB assumptions card (gates + fencing/railings) ──────────────────
function buildMixedAssumptionsCard_(existingResult, jobComponents, suggestedComplexity) {
  var gateComp   = null;
  var railComp   = null;
  for (var i = 0; i < jobComponents.length; i++) {
    if (jobComponents[i].component === 'gates')    gateComp  = jobComponents[i];
    if (jobComponents[i].component === 'railings') railComp  = jobComponents[i];
  }
  gateComp  = gateComp  || {};
  railComp  = railComp  || {};

  var isElectric = (gateComp.automation === 'electric') ||
                   ((gateComp.product_type || '').toLowerCase().includes('electric'));

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Mixed Job — Confirm Details'));

  // Hidden marker so onRecalculate knows this is a mixed job
  card.addSection(
    CardService.newCardSection()
      .addWidget(
        CardService.newSelectionInput()
          .setType(CardService.SelectionInputType.DROPDOWN)
          .setFieldName('mixed_job')
          .setTitle('Job type')
          .addItem('Gates + Fencing / Railings', 'true', true)
      )
  );

  // ── SECTION 1: GATES ─────────────────────────────────────────────────────
  var gateSection = CardService.newCardSection().setHeader('🚪 SECTION 1 — GATES');

  gateSection.addWidget(
    CardService.newTextInput()
      .setFieldName('gate_design')
      .setTitle('Design (e.g. Norfolk, Surrey, Hertfordshire)')
      .setValue(gateComp.design || '')
  );
  gateSection.addWidget(
    CardService.newTextInput()
      .setFieldName('gate_width_mm')
      .setTitle('Width (mm)')
      .setHint('e.g. 3600')
      .setValue(gateComp.width_mm ? String(gateComp.width_mm) : '')
  );
  gateSection.addWidget(
    CardService.newTextInput()
      .setFieldName('gate_height_mm')
      .setTitle('Height (mm)')
      .setHint('e.g. 1800')
      .setValue(gateComp.height_mm ? String(gateComp.height_mm) : '')
  );
  gateSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('gate_material')
      .setTitle('Material')
      .addItem('Aluminium',  'Aluminium',  true)
      .addItem('Mild Steel', 'Mild Steel', false)
  );
  gateSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('gate_type')
      .setTitle('Automation')
      .addItem('Electric automated', 'electric', isElectric)
      .addItem('Manual',             'manual',   !isElectric)
  );
  gateSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('motor_type')
      .setTitle('Motor type (if electric)')
      .addItem('Underground FROG-X',    'frog_x', isElectric)
      .addItem('Articulated arm FTX-P', 'ftx_p',  false)
      .addItem('Sliding BXV',           'bxv',    false)
      .addItem('N/A',                   'none',   !isElectric)
  );
  gateSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('access_control')
      .setTitle('Access control')
      .addItem('Remote fobs only',   'fobs',      false)
      .addItem('Keypad',             'keypad',    false)
      .addItem('GSM audio intercom', 'gsm_audio', false)
      .addItem('Video intercom',     'video',     false)
      .addItem('None',               'none',      true)
  );
  gateSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('posts_required')
      .setTitle('New posts required?')
      .addItem('Yes', 'yes', true)
      .addItem('No — using existing posts', 'no', false)
  );
  gateSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('power_available')
      .setTitle('Power available on site?')
      .addItem('Yes',                                 'yes', true)
      .addItem('No – needs consumer unit connection', 'no',  false)
  );
  gateSection.addWidget(
    CardService.newTextInput()
      .setFieldName('gate_finish')
      .setTitle('Finish / colour')
      .setHint('e.g. RAL 9005 Matt Black, Anthracite')
  );
  card.addSection(gateSection);

  // ── SECTION 2: FENCING / RAILINGS ────────────────────────────────────────
  var fenceSection = CardService.newCardSection().setHeader('🔧 SECTION 2 — FENCING / RAILINGS');

  // Show any auto-detected sections
  var detectedSections = railComp.sections || [];
  if (detectedSections.length > 0) {
    var totalDetected = detectedSections.reduce(function(s, sec) { return s + sec.length_m; }, 0);
    var sectionText = detectedSections.map(function(sec, idx) {
      return (idx + 1) + '. ' + sec.label + ': ' + sec.length_m + 'm ✓';
    }).join('\n') + '\nTotal: ' + totalDetected.toFixed(1) + 'm';
    fenceSection.addWidget(
      CardService.newTextParagraph().setText('Detected sections:\n' + sectionText)
    );
  }

  fenceSection.addWidget(
    CardService.newTextInput()
      .setFieldName('fence_total_length_m')
      .setTitle('Total fencing length (metres)')
      .setHint('e.g. 11.7')
      .setValue(railComp.total_length_m ? String(railComp.total_length_m) : '')
  );
  fenceSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('fence_type')
      .setTitle('Fencing type')
      .addItem('Steel railings to match gates',      'Steel railings to match gates',      true)
      .addItem('Timber feather edge / close board',  'Timber feather edge / close board',  false)
      .addItem('Aluminium railings',                 'Aluminium railings',                 false)
      .addItem('Decorative iron railings',           'Decorative iron railings',           false)
  );
  fenceSection.addWidget(
    CardService.newTextInput()
      .setFieldName('fence_height_m')
      .setTitle('Height (metres)')
      .setHint('e.g. 1.8')
  );
  fenceSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('fence_end_posts')
      .setTitle('Posts at each end of run?')
      .addItem('Yes', 'yes', true)
      .addItem('No',  'no',  false)
  );
  fenceSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('fence_mid_posts')
      .setTitle('Mid-span posts required?')
      .addItem('Yes — every 2.5m',    'yes',   true)
      .addItem('No — wall top / span', 'no',    false)
  );
  fenceSection.addWidget(
    CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('fence_fixing_method')
      .setTitle('Fixing method')
      .addItem('Core drilled into ground', 'Core drilled into ground', true)
      .addItem('Bolt down plate',          'Bolt down plate',          false)
      .addItem('Wall mounted',             'Wall mounted',             false)
      .addItem('Welded to existing',       'Welded to existing',       false)
  );
  addFinishDropdown_(fenceSection);
  card.addSection(fenceSection);

  return addFormActions_(card).build();
}

/** Add Details card — free-text refinement of an existing estimate. */
function buildAddDetailsCard_(messageId) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Helions Forge').setSubtitle('Add Details to Refine Estimate'))
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextInput()
            .setFieldName('add_details_text')
            .setTitle('Additional details / assumptions')
            .setHint('e.g. 4 metre wide gate opening')
            .setMultiline(true)
            .setValue('')
        )
        .addWidget(CardService.newTextParagraph()
          .setText('Examples:\n• 4 metre wide gate opening\n• 1.8m height required\n• Include GSM intercom\n• Powder coat RAL 9005 black\n• Brick to brick installation'))
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextButton()
            .setText('🔄  Regenerate Estimate')
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOnClickAction(CardService.newAction().setFunctionName('onRegenerateWithDetails'))
        )
        .addWidget(
          CardService.newTextButton()
            .setText('← Back')
            .setOnClickAction(CardService.newAction().setFunctionName('onPopCard_'))
        )
    )
    .build();
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
