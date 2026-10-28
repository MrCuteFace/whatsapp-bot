/*
  The bot, running in the browser.

  `determineRoute` is the production routing function (workflows/package-tracking.json, node
  "Determine Route"), including the SQL-injection guard. Each handler below mirrors one branch of the
  workflow: the same replies, the same buttons, the same next state. The SQL queries are replaced by
  lookups over the invented data in DATA, applying the same ownership rules the queries apply.

  Every reply is returned with a `trace`: the real workflow nodes that produce it, so the page can
  show what n8n does for each message.
*/
(function () {
  'use strict';

  // ---- invented data ----------------------------------------------------------------

  var DAY = 86400000;
  function shift(days, hh, mm) {
    var d = new Date(Date.now() + days * DAY);
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d;
  }
  function ymd(d) { return d ? '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) : '00000000'; }
  function iso(d) { return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00' : null; }
  function pad(n) { return String(n).padStart(2, '0'); }

  var COMPANIES = {
    '510000011': { shipping_agent: 'ים ספנות' },
    '510000022': { forwarder: 'אופק שילוח', customs_broker: 'אופק שילוח' },
    '510000033': { customs_broker: 'גשר מכס ושילוח' },
  };

  var PERSONAS = {
    ron: { phone: '972500000101', name: 'רון אלקיים', hp: '510000011', roles: ['shipping_agent'] },
    mirav: { phone: '972500000102', name: 'מירב שגיא', hp: '510000022', roles: ['forwarder', 'customs_broker'] },
    idan: { phone: '972500000103', name: 'עידן ברזילי', hp: '510000033', roles: ['customs_broker'] },
  };

  var DEAL_A = 'AB26TLV000123456'; // 16-character deal prefix shared by three full containers
  var DEAL_B = 'CD26HFA000778899';

  // Dates follow the real order: escort certificate, then entry, then unloading / exit.

  // Full containers (handling HH): status is public, the extra info is for the owner only.
  var FULL = [
    { container: '4521873', deal: DEAL_A + '0001', declarant: '510000011', releaseOrder: '510000033', broker: '510000033',
      entry: shift(-6), exit: null, escort: shift(-7, 9, 14), scanBooked: shift(1, 10, 30), scanIn: null, scanOut: null, customs: shift(2) },
    { container: '4521874', deal: DEAL_A + '0002', declarant: '510000011', releaseOrder: '510000033', broker: '510000033',
      entry: shift(-6), exit: null, escort: shift(-7, 9, 20), scanBooked: shift(-1, 8, 0), scanIn: shift(-1, 8, 12), scanOut: shift(-1, 9, 3), customs: null },
    { container: '4521875', deal: DEAL_A + '0003', declarant: '510000011', releaseOrder: '510000033', broker: '510000033',
      entry: shift(-4), exit: shift(-1), escort: shift(-5, 13, 40), scanBooked: null, scanIn: null, scanOut: null, customs: shift(-2) },
    { container: '4600231', deal: 'EF26ASH000445566' + '0001', declarant: '510000099', releaseOrder: '510000098', broker: '510000098',
      entry: shift(-2), exit: null, escort: shift(-3, 15, 25), scanBooked: null, scanIn: null, scanOut: null, customs: null },
  ];

  // Containers for unloading (handling PP): each package in them is a deal of its own.
  var EMPTY = [
    { container: '3310457', ownerAgent: '510000022', entry: shift(-3), rk: shift(-1), exit: null, escort: shift(-4, 11, 5),
      packages: [
        { deal: DEAL_B + '0001', forwarder: '510000022', releaseOrder: '510000033', broker: '510000033', qty: 12, weight: 840, customs: true, escort: true, exit: shift(0) },
        { deal: DEAL_B + '0002', forwarder: '510000022', releaseOrder: '510000022', broker: '510000022', qty: 4, weight: 310, customs: false, escort: false, exit: null },
        { deal: 'GH26TLV000990011' + '0001', forwarder: '510000077', releaseOrder: '510000077', broker: '510000077', qty: 30, weight: 2150, customs: true, escort: true, exit: null },
      ] },
    { container: '3310458', ownerAgent: '510000077', entry: shift(-1), rk: null, exit: null, escort: shift(-2, 8, 40),
      packages: [
        { deal: 'JK26ASH000220033' + '0001', forwarder: '510000077', releaseOrder: '510000077', broker: '510000077', qty: 8, weight: 600, customs: false, escort: false, exit: null },
      ] },
  ];

  var ROLE_LABELS = { shipping_agent: 'סוכן אונייה 🚢', forwarder: 'משלח 📦', customs_broker: 'עמיל מכס 📋' };

  // ---- sessions (the `sessions` table) -----------------------------------------------

  var sessions = {};
  var activeRole = {};

  function reset(personaKey) {
    var p = PERSONAS[personaKey];
    delete sessions[p.phone];
    activeRole[p.phone] = p.roles[0];
  }

  // ---- production routing, verbatim (plus the guard) ---------------------------------

  var safeId = function (s) { return /^[A-Za-z0-9\-\/. ]{1,40}$/.test(s) ? s : ''; };

  function determineRoute(session, msgType, rawBody) {
    var body = (rawBody || '').trim();
    var state = session ? session.state : 'NO_SESSION';
    var containerNumber = session && session.container_number;
    var containerType = session && session.container_type;
    var lastDealNumber = session && session.last_deal_number;
    var lastDealContainer = session && session.last_deal_container;
    var route;
    if (state === 'NO_SESSION') route = 'NO_SESSION';
    else if (state === 'MENU_SENT' && body === '1' && msgType === 'interactive') route = 'MENU_SENT_1';
    else if (state === 'MENU_SENT' && body === 'cargo_tracking' && msgType === 'interactive') route = 'MENU_SENT_CARGO';
    else if (state === 'MENU_SENT' && body === 'הירשם מחדש' && msgType === 'text') route = 'MENU_SENT_RESIGN_UP';
    else if (state === 'MENU_SENT' && body === 'switch_role' && msgType === 'interactive') route = 'MENU_SWITCH_ROLE';
    else if (state === 'MENU_SENT') route = 'MENU_SENT_OTHER';
    else if (state === 'TRACKING_MENU_SENT' && body === 'full_container' && msgType === 'interactive') route = 'TRACKING_FULL';
    else if (state === 'TRACKING_MENU_SENT' && body === 'empty_container' && msgType === 'interactive') route = 'TRACKING_EMPTY';
    else if (state === 'TRACKING_MENU_SENT' && body === 'recheck_last' && msgType === 'interactive' && containerNumber) { route = (containerType === 'HH') ? 'AWAITING_VALID' : 'AWAITING_EMPTY_VALID'; body = containerNumber; }
    else if (state === 'TRACKING_MENU_SENT' && body === 'declaration' && msgType === 'interactive') route = 'TRACKING_DECLARATION';
    else if (state === 'TRACKING_MENU_SENT') route = 'TRACKING_MENU_OTHER';
    else if (state === 'AWAITING_CONTAINER' && body === 'back_to_menu' && msgType === 'interactive') route = 'AWAITING_GO_BACK';
    else if (state === 'AWAITING_CONTAINER' && /^\d{7}$/.test(body)) route = 'AWAITING_VALID';
    else if (state === 'FULL_RESULT_MENU_SENT' && body === 'more_info' && msgType === 'interactive') route = 'FULL_MORE_INFO';
    else if (state === 'FULL_RESULT_MENU_SENT' && body === 'back_to_menu' && msgType === 'interactive') route = 'FULL_RESULT_GO_BACK';
    else if (state === 'FULL_RESULT_MENU_SENT' && body === 'list_containers' && msgType === 'interactive') route = 'FULL_LIST_CONTAINERS';
    else if (state === 'FULL_RESULT_MENU_SENT') route = 'FULL_RESULT_MENU_OTHER';
    else if (state === 'MORE_INFO_MENU_SENT' && body === 'customs_check' && msgType === 'interactive') route = 'CUSTOMS_CHECK';
    else if (state === 'MORE_INFO_MENU_SENT' && body === 'scan_request' && msgType === 'interactive') route = 'SCAN_REQUEST';
    else if (state === 'MORE_INFO_MENU_SENT') route = 'MORE_INFO_MENU_OTHER';
    else if (state === 'AWAITING_CONTAINER_EMPTY' && body === 'back_to_menu' && msgType === 'interactive') route = 'AWAITING_EMPTY_GO_BACK';
    else if (state === 'AWAITING_CONTAINER_EMPTY' && /^\d{7}$/.test(body)) route = 'AWAITING_EMPTY_VALID';
    else if (state === 'AWAITING_CONTAINER_EMPTY') route = 'AWAITING_EMPTY_INVALID';
    else if (state === 'EMPTY_RESULT_MENU_SENT' && body === 'empty_deal_number' && msgType === 'interactive') route = 'EMPTY_DEAL_NUMBER';
    else if (state === 'EMPTY_RESULT_MENU_SENT' && body === 'back_to_menu' && msgType === 'interactive') route = 'EMPTY_RESULT_GO_BACK';
    else if (state === 'EMPTY_RESULT_MENU_SENT' && body === 'list_packages' && msgType === 'interactive') route = 'EMPTY_LIST_PACKAGES';
    else if (state === 'EMPTY_RESULT_MENU_SENT') route = 'EMPTY_RESULT_MENU_OTHER';
    else if (state === 'AWAITING_DEAL_NUMBER_EMPTY' && body === 'back_to_menu' && msgType === 'interactive') route = 'DEAL_NUMBER_EMPTY_GO_BACK';
    else if (state === 'AWAITING_DEAL_NUMBER_EMPTY' && body === 'recheck_last_deal' && msgType === 'interactive' && lastDealNumber && lastDealContainer === containerNumber) { route = 'DEAL_NUMBER_EMPTY_SUBMITTED'; body = lastDealNumber; }
    else if (state === 'AWAITING_DEAL_NUMBER_EMPTY') { route = 'DEAL_NUMBER_EMPTY_SUBMITTED'; body = safeId(body); }
    else if (state === 'AWAITING_DEAL_NUMBER_CARGO' && body === 'back_to_menu' && msgType === 'interactive') route = 'DEAL_NUMBER_CARGO_GO_BACK';
    else if (state === 'AWAITING_DEAL_NUMBER_CARGO' && body === 'recheck_last_deal' && msgType === 'interactive' && lastDealNumber) { route = 'DEAL_NUMBER_CARGO_SUBMITTED'; body = lastDealNumber; }
    else if (state === 'AWAITING_DEAL_NUMBER_CARGO' && /^[a-z0-9]{16}$/i.test(body)) route = 'DEAL_NUMBER_CARGO_SUBMITTED';
    else if (state === 'AWAITING_DEAL_NUMBER_CARGO') route = 'DEAL_NUMBER_CARGO_INVALID';
    else if (state === 'AWAITING_DECLARATION' && body === 'back_to_menu' && msgType === 'interactive') route = 'DECLARATION_GO_BACK';
    else if (state === 'AWAITING_DECLARATION') { route = 'DECLARATION_SUBMITTED'; body = safeId(body); }
    else if (state === 'AWAITING_ROLE_SWITCH' && ['shipping_agent', 'forwarder', 'customs_broker'].indexOf(body) >= 0 && msgType === 'interactive') route = 'ROLE_SWITCH_SELECTED';
    else if (state === 'AWAITING_ROLE_SWITCH') route = 'ROLE_SWITCH_INVALID';
    else route = 'AWAITING_INVALID';
    return { route: route, body: body };
  }

  // ---- formatting, as in the workflow's code nodes ------------------------------------

  function fmtYmd(d) { var s = ymd(d); return s === '00000000' ? '❌' : s.slice(6, 8) + '/' + s.slice(4, 6) + '/' + s.slice(0, 4); }
  function fmtDate(d) { return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function fmtTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtEscort(d) { return d ? fmtDate(d) + ' ' + fmtTime(d) : '❌'; }
  function ymdOf(d) { return iso(d).split('T')[0]; }

  // ---- replies ------------------------------------------------------------------------

  function text(body) { return { type: 'text', body: body }; }
  function buttons(body, list) { return { type: 'buttons', body: body, buttons: list }; }
  function btn(id, title) { return { id: id, title: title }; }
  var BACK = btn('back_to_menu', 'חזרה לתפריט');

  function mainMenu(persona) {
    var role = activeRole[persona.phone];
    var list = [btn('1', 'מעקב מכולה')];
    if (role === 'customs_broker') list.push(btn('cargo_tracking', 'מעקב מטען'));
    if (persona.roles.length > 1) list.push(btn('switch_role', 'החלף תפקיד 🔄'));
    return buttons('שלום ' + persona.name + '! 👋 אתה מחובר בתור ' + (ROLE_LABELS[role] || role) + ' מטעם ' + COMPANIES[persona.hp][role], list);
  }

  function trackingMenu(session) {
    var list = [btn('full_container', 'מכולה מלאה'), btn('empty_container', 'מכולת ריקון')];
    if (session.container_number) list.push(btn('recheck_last', 'מכולה מספר ' + session.container_number));
    return buttons('בחר סוג מעקב:', list);
  }

  function ownsFull(row, persona) {
    var role = activeRole[persona.phone];
    if (role === 'customs_broker') return row.releaseOrder === persona.hp || row.broker === persona.hp;
    return row.declarant === persona.hp;
  }

  /** Back to the main menu: "Reset State: Menu Sent" -> "Get User Role (Main Menu)" -> "Send Main Menu". */
  function toMenu(session, persona, replies, trace) {
    session.state = 'MENU_SENT';
    replies.push(mainMenu(persona));
    trace.push('Reset State: Menu Sent', 'Get User Role (Main Menu)', 'Send Main Menu');
  }

  function handle(personaKey, msgType, rawBody) {
    var persona = PERSONAS[personaKey];
    var session = sessions[persona.phone] || null;
    var r = determineRoute(session, msgType, rawBody);
    var replies = [];
    var trace = ['Webhook', 'Verify Meta Signature', 'Get Session State', 'Determine Route'];
    var note = null;

    if (!session) {
      session = sessions[persona.phone] = { state: 'MENU_SENT', container_number: null, container_type: null, last_deal_number: null, last_deal_container: null };
      replies.push(mainMenu(persona));
      trace.push('New Session: Insert Menu Sent', 'Get User Role (Main Menu)', 'Send Main Menu');
      return finish();
    }

    switch (r.route) {
      case 'MENU_SENT_1':
        session.state = 'TRACKING_MENU_SENT';
        replies.push(trackingMenu(session));
        trace.push('Set State: Tracking Menu Sent', 'Get User Role', 'Send Tracking Submenu');
        break;
      case 'MENU_SENT_OTHER':
        replies.push(mainMenu(persona));
        trace.push('Get User Role (Main Menu)', 'Send Main Menu');
        break;
      case 'MENU_SENT_CARGO':
        session.state = 'AWAITING_DEAL_NUMBER_CARGO';
        var cargoButtons = [];
        if (session.last_deal_number) cargoButtons.push(btn('recheck_last_deal', session.last_deal_number));
        cargoButtons.push(BACK);
        replies.push(buttons('הזינו את מזהה העסקה:', cargoButtons));
        trace.push('Set State: Awaiting Deal Number (Cargo)', 'Ask Deal Number (Cargo)');
        break;
      case 'MENU_SWITCH_ROLE':
        session.state = 'AWAITING_ROLE_SWITCH';
        replies.push(buttons('לאיזה תפקיד תרצה לעבור?', otherRoles(persona).map(function (role) { return btn(role, ROLE_LABELS[role]); })));
        trace.push('Set State: Awaiting Role Switch', 'Query Other Roles', 'Ask Which Role');
        break;
      case 'ROLE_SWITCH_SELECTED':
        activeRole[persona.phone] = r.body;
        trace.push('Update Active Role');
        toMenu(session, persona, replies, trace);
        break;
      case 'ROLE_SWITCH_INVALID':
        replies.push(buttons('לאיזה תפקיד תרצה לעבור?', otherRoles(persona).map(function (role) { return btn(role, ROLE_LABELS[role]); })));
        trace.push('Query Other Roles', 'Ask Which Role');
        break;
      case 'MENU_SENT_RESIGN_UP':
        replies.push(text('נמחקת מהמערכת. שלח כל הודעה כדי להירשם מחדש'));
        trace.push('Delete Registration (Resign Up)', 'Send Resign Up Confirmation');
        note = 'In production the number is now unregistered, and self-serve sign-up is switched off, so an admin re-adds it from the admin app. The demo re-adds you on your next message.';
        delete sessions[persona.phone];
        break;

      case 'TRACKING_FULL':
        session.state = 'AWAITING_CONTAINER';
        replies.push(buttons('הזינו את מספר המכולה:', [BACK]));
        trace.push('Set State: Awaiting Container (Full)', 'Ask Container Number (Full)');
        break;
      case 'TRACKING_EMPTY':
        session.state = 'AWAITING_CONTAINER_EMPTY';
        replies.push(buttons('הזינו את מספר המכולה:', [BACK]));
        trace.push('Set State: Awaiting Container (Empty)', 'Ask Container Number (Empty)');
        break;
      case 'TRACKING_MENU_OTHER':
        replies.push(trackingMenu(session));
        trace.push('Get User Role', 'Send Tracking Submenu');
        break;

      case 'AWAITING_VALID':
        trace.push('Query Container Status (Full)', 'Branch: Full Container Found?');
        var full = FULL.filter(function (c) { return c.container === r.body; })[0];
        if (!full) {
          replies.push(text('המכולה אינה קיימת במערכת ואינה צפויה להגיע 🚫'));
          trace.push('Send Not Found (Generic)');
          toMenu(session, persona, replies, trace);
          break;
        }
        var owner = ownsFull(full, persona);
        var siblings = owner ? FULL.filter(function (c) { return c !== full && c.deal.slice(0, 16) === full.deal.slice(0, 16); }).length : 0;
        var fullButtons = [];
        if (owner) fullButtons.push(btn('more_info', 'מידע נוסף'));
        if (siblings > 0) fullButtons.push(btn('list_containers', 'מכולות נוספות (' + siblings + ')'));
        fullButtons.push(BACK);
        replies.push(buttons('סטטוס מכולה 📦\n\nתעודת ליווי: ' + fmtEscort(full.escort) + '\nתאריך כניסה: ' + fmtYmd(full.entry) + '\nתאריך יציאה: ' + fmtYmd(full.exit), fullButtons));
        session.state = 'FULL_RESULT_MENU_SENT';
        session.container_number = full.container;
        session.container_type = 'HH';
        trace.push('Format Livoi Date', 'Send Full Container Status', 'Set State: Full Result Menu Sent');
        if (!owner) note = 'Container status is public, so the bot answers - but the extra options only appear for the company that owns it.';
        break;
      case 'AWAITING_INVALID':
        replies.push(buttons('פורמט לא תקין ❌\nמספר מכולה חייב להכיל 7 ספרות בלבד (לדוגמה: 1234567)\nנסו שנית:', [BACK]));
        trace.push('Send Invalid Format (Container)');
        break;
      case 'FULL_MORE_INFO':
        session.state = 'MORE_INFO_MENU_SENT';
        replies.push(buttons('בחר סוג מידע:', [btn('customs_check', 'בדיקת מכס פיזי'), btn('scan_request', 'הזמנה לשיקוף')]));
        trace.push('Set State: More Info Menu Sent', 'Send More Info Submenu');
        break;
      case 'FULL_LIST_CONTAINERS':
        trace.push('Query Sibling Containers (Full)', 'Build Sibling Containers Message', 'Send Sibling Containers');
        replies.push(text(siblingMessage(session.container_number, persona)));
        toMenu(session, persona, replies, trace);
        break;
      case 'CUSTOMS_CHECK':
        trace.push('Query Customs Status', 'Build Customs Status Message', 'Send Customs Status');
        replies.push(text(customsMessage(ownedFull(session.container_number, persona))));
        toMenu(session, persona, replies, trace);
        break;
      case 'SCAN_REQUEST':
        trace.push('Query Scan Status', 'Build Scan Status Message1', 'Send Scan Status');
        replies.push(text(scanMessage(ownedFull(session.container_number, persona))));
        toMenu(session, persona, replies, trace);
        break;

      case 'AWAITING_EMPTY_VALID':
        trace.push('Query Container Status (Empty)', 'Branch: Empty Container Found?');
        var empty = EMPTY.filter(function (c) { return c.container === r.body; })[0];
        if (!empty) {
          replies.push(text('המכולה אינה קיימת במערכת ואינה צפויה להגיע 🚫'));
          trace.push('Send Not Found (Generic)');
          toMenu(session, persona, replies, trace);
          break;
        }
        var isForwarder = activeRole[persona.phone] === 'forwarder';
        var primary = isForwarder && empty.ownerAgent === persona.hp;
        var own = empty.packages.filter(function (p) { return p.forwarder === persona.hp; }).length;
        var isOwner = isForwarder && (primary || own > 0);
        var body = 'סטטוס מכולה 📦\n\nתעודת ליווי: ' + fmtEscort(empty.escort) + '\nתאריך כניסה: ' + fmtYmd(empty.entry) + '\nתאריך ריקון: ' + fmtYmd(empty.rk) + '\nתאריך יציאה: ' + fmtYmd(empty.exit);
        if (primary) body += '\nסה"כ מטענים במכולה: ' + empty.packages.length;
        if (isOwner) body += '\nמטענים ששייכים לך: ' + own;
        replies.push(buttons(body, [BACK]));
        session.state = 'EMPTY_RESULT_MENU_SENT';
        session.container_number = empty.container;
        session.container_type = 'PP';
        trace.push('Format Livoi Date (Empty)', 'Send Empty Status + Deal Choice', 'Set State: Empty Result Menu Sent');
        break;
      case 'AWAITING_EMPTY_INVALID':
        replies.push(buttons('פורמט לא תקין ❌\nמספר מכולה חייב להכיל 7 ספרות בלבד (לדוגמה: 1234567)\nנסו שנית:', [BACK]));
        trace.push('Send Invalid Format (Container)');
        break;

      case 'DEAL_NUMBER_CARGO_SUBMITTED':
        trace.push('Query Deal Status (Cargo)', 'Build Cargo Deal Message', 'Branch: Cargo Deal Found?');
        var all = [];
        EMPTY.forEach(function (c) { c.packages.forEach(function (p) { if (p.deal.slice(0, 16).toLowerCase() === r.body.toLowerCase()) all.push(p); }); });
        var owned = all.filter(function (p) { return p.releaseOrder === persona.hp || p.broker === persona.hp; });
        if (all.length === 0) {
          replies.push(buttons(' מזהה העסקה לא נמצא במערכת ❌\nבדקו את המספר ונסו שוב:', [BACK]));
          trace.push('Send Deal Not Found');
        } else if (owned.length === 0) {
          replies.push(buttons('מזהה העסקה קיים במערכת, אך אינו שייך לך 🚫', [BACK]));
          trace.push('Send Deal Not Yours');
        } else {
          replies.push(text(owned.map(packageBlock).join('\n\n')));
          session.last_deal_number = r.body;
          session.last_deal_container = null;
          trace.push('Send Cargo Deal List', 'Set State: Save Last Deal');
          toMenu(session, persona, replies, trace);
        }
        break;
      case 'DEAL_NUMBER_CARGO_INVALID':
        replies.push(buttons('פורמט לא תקין ❌\nמזהה העסקה חייב להכיל 16 תווים (אותיות באנגלית ו/או ספרות)\nנסו שנית:', [BACK]));
        trace.push('Send Invalid Format (Cargo Deal)');
        break;

      // Routes the production menus no longer offer a button for (kept for old messages).
      case 'TRACKING_DECLARATION':
      case 'EMPTY_DEAL_NUMBER':
      case 'EMPTY_LIST_PACKAGES':
      case 'DEAL_NUMBER_EMPTY_SUBMITTED':
      case 'DECLARATION_SUBMITTED':
        toMenu(session, persona, replies, trace);
        break;

      default: // every "back to menu" and every "something else" on a result screen
        toMenu(session, persona, replies, trace);
    }
    return finish();

    function finish() {
      return { route: r.route, state: sessions[persona.phone] ? sessions[persona.phone].state : '(unregistered)', replies: replies, trace: trace, note: note, guarded: r.body !== (rawBody || '').trim() && /SUBMITTED$/.test(r.route) };
    }
  }

  function otherRoles(persona) {
    return persona.roles.filter(function (role) { return role !== activeRole[persona.phone]; });
  }

  function ownedFull(container, persona) {
    return FULL.filter(function (c) { return c.container === container && ownsFull(c, persona); })[0] || null;
  }

  function customsMessage(row) {
    if (!row || !row.customs) return '🚫 לא צפויה בדיקת מכס פיזי למכולה';
    var check = ymdOf(row.customs);
    var today = ymdOf(new Date());
    if (today < check) return 'בדיקת מכס פיזי צפויה למכולה בתאריך: ' + fmtDate(row.customs);
    if (today === check) return 'המכולה נמצאת כעת בבדיקת מכס פיזי החל מתאריך: ' + fmtDate(row.customs);
    return 'המכולה יצאה מבדיקת מכס פיזי בתאריך: ' + fmtDate(row.customs);
  }

  function scanMessage(row) {
    if (row && row.scanOut) return 'המכולה יצאה משיקוף בתאריך: ' + fmtDate(row.scanOut) + ' ובשעה: ' + fmtTime(row.scanOut);
    if (row && row.scanIn) return 'המכולה נכנסה לשיקוף בתאריך: ' + fmtDate(row.scanIn) + ' ובשעה: ' + fmtTime(row.scanIn);
    if (row && row.scanBooked) return 'שיקוף הוזמן לתאריך: ' + fmtDate(row.scanBooked) + ' ובשעה: ' + fmtTime(row.scanBooked);
    return 'למכולה לא מתוכננת שיקוף 🚫';
  }

  function siblingMessage(container, persona) {
    var base = FULL.filter(function (c) { return c.container === container; })[0];
    var rows = base ? FULL.filter(function (c) { return c !== base && c.deal.slice(0, 16) === base.deal.slice(0, 16) && ownsFull(c, persona); }) : [];
    if (rows.length === 0) return 'לא נמצאו מכולות נוספות בעסקה זו';
    return rows.map(function (j) {
      var block = '📦 מכולה מספר: ' + j.container + '\nתעודת ליווי: ' + fmtEscort(j.escort) + '\nתאריך כניסה: ' + fmtYmd(j.entry) + '\nתאריך יציאה: ' + fmtYmd(j.exit);
      if (j.scanOut) block += '\nהמכולה יצאה משיקוף בתאריך: ' + fmtDate(j.scanOut) + ' ובשעה: ' + fmtTime(j.scanOut);
      else if (j.scanIn) block += '\nהמכולה נכנסה לשיקוף בתאריך: ' + fmtDate(j.scanIn) + ' ובשעה: ' + fmtTime(j.scanIn);
      else if (j.scanBooked) block += '\nשיקוף הוזמן לתאריך: ' + fmtDate(j.scanBooked) + ' ובשעה: ' + fmtTime(j.scanBooked);
      if (j.customs) block += '\n' + customsMessage(j);
      return block;
    }).join('\n\n');
  }

  function packageBlock(j) {
    return '📦 מזהה עסקה: ' + j.deal + '\nכמות: ' + j.qty + '\nמשקל: ' + j.weight + ' ק"ג\nהתרת מכס: ' + (j.customs ? '✅' : '❌') + '\nתעודת ליווי: ' + (j.escort ? '✅' : '❌') + '\nתאריך יציאה: ' + fmtYmd(j.exit);
  }

  window.CargoBot = {
    PERSONAS: PERSONAS,
    COMPANIES: COMPANIES,
    ROLE_LABELS: ROLE_LABELS,
    handle: handle,
    reset: reset,
    activeRole: function (personaKey) { return activeRole[PERSONAS[personaKey].phone]; },
    samples: {
      full: ['4521873', '4600231', '9999999'],
      empty: ['3310457', '3310458'],
      cargo: [DEAL_B, 'GH26TLV000990011'],
    },
  };
})();
