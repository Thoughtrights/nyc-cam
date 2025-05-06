/* Note: I have a yet unfound bug with leaflet. lat/lon get mangled in some way. */

window.addEventListener('resize', function(event) {
  // Code to execute when the window is resized when it is in map mode already
  if(GRID.classList.contains('hidden')) {
    switchToMap();
  }
});

var $ = function(sel){ return document.querySelector(sel); };
var accent = function(){ return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); };
var bust = function(u){ return u + '?t=' + Date.now(); };
var Y2M = 0.9144;
var FPS = 1000;
var hav = function(a,b){
  var p=Math.PI/180;
  var dLat = (b.latitude - a.latitude) * p;
  var dLon = (b.longitude - a.longitude) * p;
  var R = 6371000;
  var h = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.sin(dLon/2)*Math.sin(dLon/2) * Math.cos(a.latitude*p) * Math.cos(b.latitude*p);
  return 2*R*Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
};

// Elements
var GRID = $('#grid'), MAP_DIV = $('#map'), PANEL = $('#panel');
var SEARCH = $('#search'), TOGGLE = $('#toggleView'), FSBTN = $('#fsBtn');
var TPL = document.getElementById('tplCard').content;
var MODAL = $('#modal'), M_CLOSE = $('#modalClose');
var M_IMG = $('#modalImage'), M_NAME = $('#mName'), M_TIME = $('#mTime'), M_LATLON = $('#mLatLon'), META_MAP = $('#metaMap');

// State
var cams = [], map, cluster, currentSubset = [], gridTimer, modalTimer, currentCam = null, mini;

// Init
fetch('config.json').then(function(r){ return r.json(); }).then(function(data){
  cams = data;
  buildGrid();
  initMap();
  attachNearby();
});

// Grid
function buildGrid(list){
  if(!list) list = cams;
  GRID.innerHTML = '';
  list.forEach(function(c){
    var card = TPL.cloneNode(true);
    var img = card.querySelector('img');
    img.src = bust(c.imageUrl);
    img.dataset.base = c.imageUrl;
    card.querySelector('figcaption').textContent = c.name;
    card.querySelector('figure').onclick = function(){ openModal(c); };
    GRID.appendChild(card);
  });
  observeGrid();
}
function observeGrid(){
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){ e.target.classList.add('isVis'); }
      else { e.target.classList.remove('isVis'); }
    });
  }, {threshold:0.1});
  GRID.querySelectorAll('img').forEach(function(i){ io.observe(i); });
}
function gridRefresh(){
  GRID.querySelectorAll('img.isVis').forEach(function(i){ i.src = bust(i.dataset.base); });
}

// Map
function initMap(){
  map = L.map(MAP_DIV);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
  cluster = L.markerClusterGroup();
  cams.forEach(function(c){
    if(!c.latitude) return;
    var m = L.circleMarker([c.latitude, c.longitude], {
      radius: 6,
      color: accent(),
      fillColor: accent(),
      fillOpacity: 1
    });
    m.on('click', function(){ openModal(c); });
    cluster.addLayer(m);
  });
  map.addLayer(cluster);
  var bb = cluster.getBounds();
  if(bb.isValid()){ map.fitBounds(bb, {padding:[40,40], maxZoom:12}); }
  else { map.setView([40.73,-73.94], 11); }
  map.on('moveend', updatePanel);
  updatePanel();
}
function updatePanel(){
  var b = map.getBounds();
  currentSubset = cams.filter(function(c){ return c.latitude && b.contains([c.latitude, c.longitude]); });
  var html = '<header>' + currentSubset.length + ' cams <button id="showSubset">Grid</button></header><ul>';
  currentSubset.forEach(function(c){
    html += '<li data-id="' + (c.id || c.imageUrl) + '">' + c.name + '</li>';
  });
  html += '</ul>';
  PANEL.innerHTML = html;
  document.getElementById('showSubset').onclick = function(){ switchToGrid(currentSubset); };
  PANEL.querySelectorAll('li').forEach(function(li){
    li.onclick = function(){ openModal(findCam(li.dataset.id)); };
  });
}
function findCam(id){
  return cams.find(function(c){ return c.id == id || c.imageUrl == id; });
}

// Modal
function openModal(cam){
  currentCam = cam;
  MAP_DIV.classList.add('hidden');
  GRID.classList.remove('hidden');
  FSBTN.classList.remove('hidden');
  FSBTN.textContent='Full Screen';
  TOGGLE.textContent = 'Map ▸ Grid';

  M_IMG.src = bust(cam.imageUrl);
  M_NAME.textContent = cam.name;
  if(cam.latitude){
    M_LATLON.textContent = cam.latitude.toFixed(5) + ', ' + cam.longitude.toFixed(5);
  } else {
    M_LATLON.textContent = 'N/A';
  }
  M_TIME.textContent = new Date().toLocaleTimeString();
  setupMini();
  MODAL.classList.add('show');
  clearInterval(modalTimer);
  modalTimer = setInterval(function(){
    M_IMG.src = bust(currentCam.imageUrl);
    M_TIME.textContent = new Date().toLocaleTimeString();
  }, FPS);
}
function setupMini(){
  if(!mini){
    mini = L.map(META_MAP, {attributionControl:false, zoomControl:false, dragging:false, scrollWheelZoom:false});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(mini);
  }
  mini.eachLayer(function(l){
    if(l instanceof L.CircleMarker || l instanceof L.Path) mini.removeLayer(l);
  });
  L.circleMarker([currentCam.latitude,currentCam.longitude],{radius:7,color:'#fff',weight:2,fillColor:accent(),fillOpacity:1}).addTo(mini);
  currentSubset.forEach(function(o){
    if(o===currentCam) return;
    L.circleMarker([o.latitude,o.longitude],{radius:5,color:accent(),fillColor:accent(),fillOpacity:0.4}).addTo(mini);
  });
  mini.setView([currentCam.latitude,currentCam.longitude],16);
  setTimeout(function(){ mini.invalidateSize(); },0);
}
function closeModal(){
  clearInterval(modalTimer);
  MODAL.classList.remove('show');
}
M_CLOSE.onclick = closeModal;
MODAL.onclick = function(e){ if(e.target === MODAL) closeModal(); };

function attachNearby(){
  document.querySelectorAll('.nearbyBtn').forEach(function(btn){
    btn.onclick = function(){
      if(!currentCam) return;
      var yard = parseInt(btn.dataset.yard,10);
      var near = cams.filter(function(c){ return c !== currentCam && c.latitude && hav(currentCam,c) <= yard * Y2M; });
      closeModal();
      switchToGrid(near);
    };
  });
}

function switchToGrid(list){
  MAP_DIV.classList.add('hidden');
  GRID.classList.remove('hidden');
  TOGGLE.textContent = 'Map ▸ Grid';
  FSBTN.classList.remove('hidden');
  FSBTN.textContent='Full Screen';
  buildGrid(list);
  clearInterval(gridTimer);
  gridRefresh();
  gridTimer = setInterval(gridRefresh, FPS);
}
function switchToMap(){
  GRID.classList.add('hidden');
  MAP_DIV.classList.remove('hidden');
  TOGGLE.textContent = 'Grid ▸ Map';
  FSBTN.classList.add('hidden');
  clearInterval(gridTimer);

/* ******** 
  if(currentSubset && currentSubset.length){
    var bounds = L.latLngBounds(currentSubset.map(function(c){ return [c.latitude, c.longitude]; }));
    map.fitBounds(bounds, {padding:[40,40], maxZoom:15});
  }else{
    map.setView([40.758,-73.985],13); // midtown default
  }
********** */
  // Always centre on Midtown NYC
/*  map.setView([40.758, -73.985], 15); */
  map.setView([40.73,-73.94], 11);
  map.invalidateSize();
  updatePanel();
}

TOGGLE.onclick = function(){
  if(GRID.classList.contains('hidden')) switchToGrid(currentSubset.length ? currentSubset : cams);
  else switchToMap();
};

SEARCH.oninput = function(e){
  var q = e.target.value.toLowerCase();
  GRID.querySelectorAll('figure.cam').forEach(function(f){
    f.classList.toggle('hidden', f.textContent.toLowerCase().indexOf(q) === -1);
  });
  PANEL.querySelectorAll('li').forEach(function(li){
    li.classList.toggle('hidden', li.textContent.toLowerCase().indexOf(q) === -1);
  });
};

FSBTN.onclick = function(){
  var fs = document.body.classList.toggle('fs');
  FSBTN.textContent = fs ? 'Exit Full Screen' : 'Full Screen';
  if(!fs){
    // Ensure we remain in grid mode with panel/header restored
    switchToGrid(currentSubset.length ? currentSubset : cams);
  }
};
