/* Onyx — icônes 3D des catégories.
   Chaque icône minimaliste (genre-icons.js) devient une petite sculpture en
   métal blanc poli : les traits sont des tubes arrondis, posés sur plusieurs
   plans de profondeur. La carte sélectionnée reçoit le rendu en direct :
   la sculpture tourne en douceur, puis s'arrête net quand on quitte la carte. */
(function () {
  'use strict';
  var Onyx = window.Onyx = window.Onyx || {};
  var T = window.THREE;

  var supported = (function () {
    if (!T || !T.SVGLoader || !T.RoomEnvironment || !Onyx.genreIcon) return false;
    try { var c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; }
  })();

  var RADIUS = 1.25;            // épaisseur du trait (unités de l'icône 48×48)
  var DEPTH = { m: 4.5, m2: 8 }; // décalage en profondeur des éléments animés

  /* Tracé SVG 2D → chemin 3D (suite de segments, angles nets respectés) */
  function path3(pts) {
    var cp = new T.CurvePath();
    for (var i = 0; i < pts.length - 1; i++) {
      if (pts[i].distanceTo(pts[i + 1]) < 1e-4) continue;
      cp.add(new T.LineCurve3(new T.Vector3(pts[i].x, pts[i].y, 0), new T.Vector3(pts[i + 1].x, pts[i + 1].y, 0)));
    }
    return cp;
  }

  var MAT = null;
  function material() {
    if (MAT) return MAT;
    MAT = new T.MeshPhysicalMaterial({ color: 0xeef0f5, metalness: 0.85, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.12 });
    return MAT;
  }

  /* Construit la sculpture d'une catégorie */
  var built = {};
  function build(id) {
    if (built[id]) return built[id];
    var svg = Onyx.genreIcon(id);
    var data = new T.SVGLoader().parse(svg);
    var root = new T.Group(), mat = material();
    var joint = new T.SphereGeometry(RADIUS, 12, 8);
    data.paths.forEach(function (sp) {
      var node = sp.userData && sp.userData.node, z = 0;
      for (var n = node; n && n.tagName && n.tagName.toLowerCase() !== 'svg'; n = n.parentNode) {
        var cls = n.getAttribute && n.getAttribute('class');
        if (cls && DEPTH[cls] !== undefined) { z = DEPTH[cls]; break; }
      }
      sp.subPaths.forEach(function (sub) {
        var pts = sub.getPoints(10);
        if (pts.length < 2) return;
        var closed = pts[0].distanceTo(pts[pts.length - 1]) < 0.01;
        var curve = path3(pts);
        if (!curve.curves.length) return;
        var segs = Math.max(8, Math.min(320, Math.round(Math.max(curve.getLength() * 2.5, pts.length * 1.5))));
        var tube = new T.Mesh(new T.TubeGeometry(curve, segs, RADIUS, 10, closed), mat);
        tube.position.z = z;
        root.add(tube);
        // articulations et extrémités arrondies (aucun angle vif)
        sub.curves.forEach(function (cv) {
          [cv.getPoint(0), cv.getPoint(1)].forEach(function (v) {
            var s = new T.Mesh(joint, mat); s.position.set(v.x, v.y, z); root.add(s);
          });
        });
      });
    });
    // repère SVG (y vers le bas) → repère 3D, centré, à l'échelle
    var wrap = new T.Group();
    root.scale.set(1 / 24, -1 / 24, 1 / 24);
    var box = new T.Box3().setFromObject(root), center = new T.Vector3();
    box.getCenter(center);
    root.position.sub(center);
    wrap.add(root);
    built[id] = wrap;
    return wrap;
  }

  /* ---------- Rendu : studio photo neutre, contre-jour teinté de la catégorie ---------- */
  var stages = {};
  function stage(kind) {
    if (stages[kind]) return stages[kind];
    if (!supported) return null;
    var r;
    try { r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { supported = false; return null; }
    r.setClearColor(0x000000, 0);
    r.outputEncoding = T.sRGBEncoding;
    r.toneMapping = T.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.25;
    r.physicallyCorrectLights = true;
    var scene = new T.Scene();
    var pm = new T.PMREMGenerator(r);
    scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    pm.dispose();
    var key = new T.DirectionalLight(0xffffff, 1.6); key.position.set(2, 3, 4); scene.add(key);
    var rim = new T.DirectionalLight(0xffffff, 3.2); rim.position.set(-3, 1, -3); scene.add(rim);
    var fill = new T.PointLight(0xffffff, 6, 0, 2); fill.position.set(2.5, -1.5, 2.5); scene.add(fill);
    var cam = new T.PerspectiveCamera(26, 1, 0.1, 20);
    cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0);
    stages[kind] = { r: r, scene: scene, cam: cam, rim: rim, fill: fill, obj: null };
    return stages[kind];
  }
  var REST = { y: -0.42, x: 0.14 }; // pose de trois-quarts au repos
  function mount(st, id, color) {
    var obj = build(id);
    if (st.obj && st.obj !== obj) st.scene.remove(st.obj);
    st.scene.add(obj);
    st.obj = obj;
    var c = new T.Color(color || '#ffffff'); c.lerp(new T.Color(0xffffff), 0.35);
    st.rim.color = c;
    st.fill.color = new T.Color(color || '#ffffff').lerp(new T.Color(0xffffff), 0.7);
    obj.rotation.set(REST.x, REST.y, 0);
    obj.position.set(0, 0, 0);
    return obj;
  }

  /* Image fixe d'une sculpture (cartes non sélectionnées) */
  var stills = {};
  function thumb(id, color, px) {
    var k = id + '|' + px;
    if (stills[k]) return stills[k];
    var st = stage('still');
    if (!st) return null;
    try {
      st.r.setSize(px, px, false);
      mount(st, id, color);
      st.r.render(st.scene, st.cam);
      stills[k] = st.r.domElement.toDataURL('image/png');
    } catch (e) { return null; }
    st.scene.remove(st.obj); st.obj = null;
    return stills[k];
  }

  /* Sculpture en direct dans la carte sélectionnée : elle démarre en douceur et tourne */
  var live = null, raf = 0;
  function attach(box, id, color, px) {
    var st = stage('live');
    if (!st) return;
    detach();
    st.r.setSize(px, px, false);
    var obj = mount(st, id, color);
    var canvas = st.r.domElement;
    canvas.className = 'g3d-live';
    box.appendChild(canvas);
    st.r.render(st.scene, st.cam);
    box.classList.add('live');
    var token = live = { box: box, obj: obj };
    var t0 = performance.now(), last = t0, angle = REST.y, speed = 0;
    (function loop(t) {
      if (live !== token) return;
      var dt = Math.min(0.05, Math.max(0, (t - last) / 1000)); last = t;
      var el = (t - t0) / 1000;
      speed += (1.05 - speed) * Math.min(1, dt * 2.4); // accélération progressive
      angle += speed * dt;
      obj.rotation.y = angle;
      obj.rotation.x = REST.x + Math.sin(el * 1.4) * 0.05;
      obj.position.y = Math.sin(el * 1.8) * 0.035;
      st.r.render(st.scene, st.cam);
      raf = requestAnimationFrame(loop);
    })(t0);
  }
  /* Arrêt : la sculpture reste figée là où elle s'est arrêtée */
  function detach() {
    if (!live) return;
    cancelAnimationFrame(raf);
    var l = live; live = null;
    var st = stages.live;
    try {
      st.r.render(st.scene, st.cam);
      var img = l.box.querySelector('img.g3d-still');
      if (img) img.src = st.r.domElement.toDataURL('image/png');
    } catch (e) { }
    if (st.r.domElement.parentNode) st.r.domElement.parentNode.removeChild(st.r.domElement);
    l.box.classList.remove('live');
  }

  Onyx.Genre3D = { supported: supported, thumb: thumb, attach: attach, detach: detach };
})();
