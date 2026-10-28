/* The chat UI: renders the bot's replies WhatsApp-style and narrates each turn in the side panel. */
(function () {
  'use strict';

  var bot = window.CargoBot;
  var chat = document.getElementById('chat');
  var form = document.getElementById('composer');
  var input = document.getElementById('input');
  var statusLine = document.getElementById('status');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var persona = 'ron';
  var busy = false;

  var ROLE_EN = { shipping_agent: 'Shipping agent', forwarder: 'Forwarder', customs_broker: 'Customs broker' };
  var REPLY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>';

  // ---- personas and samples --------------------------------------------------------

  function renderPersonas() {
    var host = document.getElementById('personas');
    host.innerHTML = '';
    Object.keys(bot.PERSONAS).forEach(function (key) {
      var p = bot.PERSONAS[key];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'persona';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', key === persona ? 'true' : 'false');
      b.innerHTML =
        '<span class="persona__name">' + p.name + '</span>' +
        '<span class="persona__roles">' + p.roles.map(function (r) { return '<span class="role-tag">' + ROLE_EN[r] + '</span>'; }).join('') + '</span>' +
        '<span class="persona__company">' + bot.COMPANIES[p.hp][p.roles[0]] + '</span>';
      b.addEventListener('click', function () {
        if (key === persona) return;
        persona = key;
        renderPersonas();
        restart();
      });
      host.appendChild(b);
    });
  }

  function renderSamples() {
    var groups = [
      { label: 'Full container (מכולה מלאה)', items: [['4521873', 'Ron\'s'], ['4600231', 'someone else\'s'], ['9999999', 'unknown'], ['12ab', 'bad format']] },
      { label: 'Container for unloading (מכולת ריקון)', items: [['3310457', 'Mirav\'s'], ['3310458', 'someone else\'s']] },
      { label: 'Cargo deal, as a customs broker (מעקב מטען)', items: [['CD26HFA000778899', ''], ['GH26TLV000990011', 'not yours']] },
    ];
    var host = document.getElementById('samples');
    groups.forEach(function (g) {
      var row = document.createElement('div');
      row.className = 'sample-group';
      row.innerHTML = '<span class="sample-group__label">' + g.label + '</span>';
      g.items.forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sample';
        b.innerHTML = item[0] + (item[1] ? '<small>' + item[1] + '</small>' : '');
        b.addEventListener('click', function () { send('text', item[0], item[0]); });
        row.appendChild(b);
      });
      host.appendChild(row);
    });
  }

  // ---- chat rendering --------------------------------------------------------------

  function now() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function scrollDown() { chat.scrollTop = chat.scrollHeight; }

  function addMessage(dir, textBody, replyButtons) {
    var wrap = document.createElement('div');
    wrap.className = 'msg msg--' + dir + (replyButtons && replyButtons.length ? ' msg--buttons' : '');
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    // Each message takes its own direction, as in WhatsApp: a typed Latin ID reads left to right.
    bubble.dir = 'auto';
    bubble.textContent = textBody;
    var meta = document.createElement('span');
    meta.className = 'meta';
    meta.innerHTML = now() + (dir === 'out' ? '<span class="ticks">✓✓</span>' : '');
    bubble.appendChild(meta);
    wrap.appendChild(bubble);

    if (replyButtons && replyButtons.length) {
      var list = document.createElement('div');
      list.className = 'reply-buttons';
      replyButtons.forEach(function (b) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'reply-btn';
        el.innerHTML = REPLY_ICON + '<span></span>';
        el.lastChild.textContent = b.title;
        // Like WhatsApp, buttons on older messages stay tappable; the bot decides by its state.
        el.addEventListener('click', function () { send('interactive', b.id, b.title); });
        list.appendChild(el);
      });
      wrap.appendChild(list);
    }
    chat.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  /** The typing bubble: the puzzle-sphere loader, spinning while the bot "writes". */
  function showTyping() {
    var wrap = document.createElement('div');
    wrap.className = 'msg msg--in typing';
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    var size = 26;
    var canvas = document.createElement('canvas');
    var dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    bubble.appendChild(canvas);
    bubble.appendChild(document.createTextNode('מקליד…'));
    wrap.appendChild(bubble);
    chat.appendChild(wrap);
    scrollDown();
    statusLine.textContent = 'מקליד…';

    var ctx = canvas.getContext('2d');
    var frame = 0;
    var sphere = window.PuzzleSphere;
    if (ctx && sphere) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduceMotion) {
        sphere.drawSphere(ctx, { yaw: 18, twists: [0, 0, 0], tilt: 22 }, size);
      } else {
        var start = performance.now();
        var prev = 0;
        var tick = function (t) {
          var elapsed = t - start;
          sphere.drawLoaderFrame(ctx, elapsed, prev, size);
          prev = elapsed;
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }
    }
    return function stop() {
      cancelAnimationFrame(frame);
      wrap.remove();
      statusLine.textContent = 'בוט · מקוון';
    };
  }

  // ---- the panel -------------------------------------------------------------------

  function narrate(result, stateBefore) {
    document.getElementById('hood-state').textContent = stateBefore === result.state ? result.state : stateBefore + ' → ' + result.state;
    document.getElementById('hood-route').textContent = result.route;
    var list = document.getElementById('hood-trace');
    list.innerHTML = '';
    result.trace.forEach(function (name) {
      var li = document.createElement('li');
      li.textContent = name;
      if (/^(Query|Get )/.test(name)) li.className = 'is-sql';
      else if (/^(Send|Ask)/.test(name)) li.className = 'is-send';
      else if (/^(Set State|Reset State|New Session|Update Active Role|Delete)/.test(name)) li.className = 'is-state';
      list.appendChild(li);
    });
    var note = document.getElementById('hood-note');
    var text = result.note || (result.guarded ? 'The typed value was not a plain ID, so the guard emptied it before any lookup.' : '');
    note.hidden = !text;
    note.textContent = text;
  }

  // ---- a turn ------------------------------------------------------------------------

  var lastState = 'NO_SESSION';

  function send(type, value, shown) {
    if (busy) return;
    var hint = document.getElementById('start-hint');
    if (hint) hint.remove();
    addMessage('out', shown);
    busy = true;
    var result = bot.handle(persona, type, value);
    var stop = showTyping();
    var delay = reduceMotion ? 250 : 1100;
    setTimeout(function () {
      stop();
      var i = 0;
      (function next() {
        if (i >= result.replies.length) {
          busy = false;
          return;
        }
        var reply = result.replies[i++];
        addMessage('in', reply.body, reply.type === 'buttons' ? reply.buttons : null);
        setTimeout(next, reduceMotion ? 0 : 420);
      })();
      narrate(result, lastState);
      lastState = result.state;
    }, delay);
  }

  function restart() {
    bot.reset(persona);
    lastState = 'NO_SESSION';
    chat.innerHTML = '<div class="day-chip">היום</div>';
    var hint = document.createElement('div');
    hint.className = 'system-chip';
    hint.id = 'start-hint';
    hint.innerHTML = 'שלחו הודעה כדי להתחיל<button type="button" class="start-btn">שלום 👋</button>';
    hint.querySelector('button').addEventListener('click', function () { send('text', 'שלום', 'שלום 👋'); });
    chat.appendChild(hint);
    document.getElementById('hood-state').textContent = 'NO_SESSION';
    document.getElementById('hood-route').textContent = '—';
    document.getElementById('hood-trace').innerHTML = '<li class="trace__empty">Send a message to see the path through n8n.</li>';
    document.getElementById('hood-note').hidden = true;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var value = input.value.trim();
    if (!value || busy) return;
    input.value = '';
    send('text', value, value);
  });
  document.getElementById('start').addEventListener('click', function () { send('text', 'שלום', 'שלום 👋'); });
  document.getElementById('reset').addEventListener('click', restart);

  renderPersonas();
  renderSamples();
  bot.reset(persona);
})();
