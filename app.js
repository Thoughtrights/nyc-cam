/* Note: I have a yet unfound bug with leaflet. lat/lon get mangled in some way. */

window.addEventListener('resize', function() {
  if (GRID.classList.contains('hidden')) switchToMap();
});

var $ = function(sel){ return document.querySelector(sel); };
var accent = function(){ return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); };
var bust = function(u){ return u + '?t=' + Date.now(); };
var Y2M = 0.9144;
var FPS = 1000;
var hav = function(a,b){
  var p=Math.PI/180;
  var dLat=(b.latitude-a.latitude)*p, dLon=(b.longitude-a.longitude)*p, R=6371000;
  var h=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.sin(dLon/2)*Math.sin(dLon/2)*Math.cos(a.latitude*p)*Math.cos(b.latitude*p);
  return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
};

// Elements
var GRID=$('#grid'), MAP_DIV=$('#map'), PANEL=$('#panel');
var SEARCH=$('#search'), TOGGLE=$('#toggleView'), FSBTN=$('#fsBtn');
var TPL=document.getElementById('tplCard').content;
var MODAL=$('#modal'), M_CLOSE=$('#modalClose');
var M_IMG=$('#modalImage'), M_NAME=$('#mName'), M_TIME=$('#mTime'), M_LATLON=$('#mLatLon'), META_MAP=$('#metaMap');

// State
var cams=[], map, cluster, currentSubset=[], gridTimer, modalTimer, currentCam=null, mini;
var gridList=null; // null = all cams; array = current subset shown in grid

var STATE_KEY='nycCamState', DASH_KEY='nycCamDashboards', SEEDED_KEY='nycCamSeeded';

/* ---- Persistence ---- */
function saveState(){
  var state={
    view: GRID.classList.contains('hidden') ? 'map' : 'grid',
    fs: document.body.classList.contains('fs'),
    // only save ids when it's a real subset (not all cams)
    gridIds: (gridList && gridList !== cams) ? gridList.map(function(c){ return c.id||c.imageUrl; }) : null
  };
  // Only read map position when the map div is visible — Leaflet returns garbage coords when hidden
  if(map && !MAP_DIV.classList.contains('hidden')){ var ctr=map.getCenter(); state.lat=ctr.lat; state.lng=ctr.lng; state.zoom=map.getZoom(); }
  try{ localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch(e){}
}

function restoreState(){
  var state;
  try{ state=JSON.parse(localStorage.getItem(STATE_KEY)||'null'); } catch(e){}
  if(!state) return;
  // Sanity-check coords are somewhere near NYC before restoring
  var nycBounds={latMin:40.4,latMax:41.1,lngMin:-74.4,lngMax:-73.6};
  if(state.lat && map && state.lat>nycBounds.latMin && state.lat<nycBounds.latMax && state.lng>nycBounds.lngMin && state.lng<nycBounds.lngMax){
    map.setView([state.lat, state.lng], state.zoom, {animate:false});
  }
  if(state.view==='grid'){
    var list=cams;
    if(state.gridIds && state.gridIds.length>0){
      var restored=state.gridIds.map(function(id){ return findCam(id); }).filter(Boolean);
      if(restored.length>0) list=restored;
    }
    switchToGrid(list);
    if(state.fs) document.body.classList.add('fs');
  }
}

/* ---- Dashboards ---- */
function getDashes(){ try{ return JSON.parse(localStorage.getItem(DASH_KEY)||'[]'); } catch(e){ return []; } }
function putDashes(d){ try{ localStorage.setItem(DASH_KEY, JSON.stringify(d)); } catch(e){} }

function renderDashPanel(){
  var ITEMS=document.getElementById('dashItems');
  var EMPTY=document.getElementById('dashEmpty');
  var SAVE_ROW=document.getElementById('dashSaveRow');
  // save/share buttons only make sense when grid is visible
  SAVE_ROW.classList.toggle('hidden', GRID.classList.contains('hidden'));
  var dashes=getDashes();
  EMPTY.classList.toggle('hidden', dashes.length>0);
  ITEMS.innerHTML='';
  dashes.forEach(function(d,i){
    var row=document.createElement('div');
    row.className='dash-item';
    var nameEl=document.createElement('span');
    nameEl.className='dash-name';
    nameEl.textContent=d.name+' — '+d.ids.length+' cams';
    var loadBtn=document.createElement('button');
    loadBtn.className='dash-load';
    loadBtn.textContent='Load';
    loadBtn.onclick=function(){
      var list=d.ids.map(function(id){ return findCam(id); }).filter(Boolean);
      closeDashPanel();
      switchToGrid(list);
    };
    var shareBtn=document.createElement('button');
    shareBtn.className='dash-share';
    shareBtn.textContent='🔗';
    shareBtn.title='Copy share link';
    shareBtn.onclick=function(){
      var list=d.ids.map(function(id){ return findCam(id); }).filter(Boolean);
      copyShareUrl(list, shareBtn);
    };
    var delBtn=document.createElement('button');
    delBtn.textContent='✕';
    delBtn.className='dash-del';
    delBtn.onclick=function(){
      if(!confirm('Delete "'+d.name+'"?')) return;
      var arr=getDashes(); arr.splice(i,1); putDashes(arr); renderDashPanel();
    };
    row.appendChild(nameEl);
    row.appendChild(loadBtn);
    row.appendChild(shareBtn);
    row.appendChild(delBtn);
    ITEMS.appendChild(row);
  });
}

function openDashPanel(){ renderDashPanel(); $('#dashPanel').classList.remove('hidden'); $('#dashOverlay').classList.remove('hidden'); }
function closeDashPanel(){ $('#dashPanel').classList.add('hidden'); $('#dashOverlay').classList.add('hidden'); }

/* ---- Default dashboards (seeded once per visitor) ---- */
function seedDefaults(){
  if(localStorage.getItem(SEEDED_KEY)) return;
  fetch('defaults.json').then(function(r){ return r.json(); }).then(function(defs){
    var arr=getDashes();
    // Add in reverse so first entry ends up at top
    defs.slice().reverse().forEach(function(def){
      var pool=def.area ? cams.filter(function(c){ return c.area===def.area; }) : cams;
      var lim=def.limit||12;
      // Spread evenly across the pool rather than taking the first N
      var step=Math.max(1, Math.floor(pool.length/lim));
      var ids=[];
      for(var i=0; i<pool.length && ids.length<lim; i+=step){
        ids.push(pool[i].id||pool[i].imageUrl);
      }
      if(ids.length) arr.unshift({name:def.name, ids:ids, created:Date.now()});
    });
    putDashes(arr);
    localStorage.setItem(SEEDED_KEY, '1');
  }).catch(function(){
    // defaults.json missing — just mark as seeded so we don't retry every load
    localStorage.setItem(SEEDED_KEY, '1');
  });
}

/* ---- Sharing ---- */
function makeShareUrl(list){
  // Strip dashes from UUIDs to keep the URL shorter (32 vs 36 chars each)
  var ids=list.map(function(c){ return (c.id||c.imageUrl).replace(/-/g,''); }).join(',');
  return location.href.split('#')[0]+'#s='+ids;
}

function copyShareUrl(list, btn){
  var url=makeShareUrl(list);
  var orig=btn.textContent;
  navigator.clipboard.writeText(url).then(function(){
    btn.textContent='Copied!';
    setTimeout(function(){ btn.textContent=orig; }, 2000);
  }).catch(function(){
    // Clipboard API blocked (e.g. non-HTTPS) — fall back to prompt
    prompt('Copy this link:', url);
  });
}

function checkShareHash(){
  if(!location.hash.startsWith('#s=')) return false;
  var raw=location.hash.slice(3);
  if(!raw) return false;
  var ids=raw.split(',').map(function(h){
    // Reconstruct UUID from 32-char no-dash form: 8-4-4-4-12
    if(h.length===32) return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
    return h;
  });
  var list=ids.map(function(id){ return findCam(id); }).filter(Boolean);
  if(!list.length) return false;
  switchToGrid(list);
  showSharedBanner(list);
  return true;
}

function showSharedBanner(list){
  var banner=$('#sharedBanner');
  $('#sharedBannerMsg').textContent='Shared dashboard — '+list.length+' cams';
  banner.classList.remove('hidden');
  $('#sharedBannerSave').onclick=function(){
    var name=prompt('Save as:','Shared Dashboard');
    if(!name) return;
    var ids=list.map(function(c){ return c.id||c.imageUrl; });
    var arr=getDashes();
    arr.unshift({name:name, ids:ids, created:Date.now()});
    putDashes(arr);
    banner.classList.add('hidden');
    history.replaceState(null,'',location.pathname); // clean the hash from the URL
  };
  $('#sharedBannerDismiss').onclick=function(){ banner.classList.add('hidden'); };
}

// Init
fetch('config.json').then(function(r){ return r.json(); }).then(function(data){
  cams=data;
  buildGrid();
  initMap();
  attachNearby();
  initDashUI();
  seedDefaults();
  // Shared link takes priority over restored session state
  if(!checkShareHash()) restoreState();
});

function initDashUI(){
  $('#dashBtn').onclick=openDashPanel;
  $('#dashClose').onclick=closeDashPanel;
  $('#dashOverlay').onclick=closeDashPanel;
  $('#dashSaveConfirm').onclick=function(){
    var inp=$('#dashNameInput');
    var name=inp.value.trim()||'Dashboard '+(getDashes().length+1);
    var ids=(gridList && gridList!==cams ? gridList : cams).map(function(c){ return c.id||c.imageUrl; });
    var arr=getDashes();
    arr.unshift({name:name, ids:ids, created:Date.now()});
    putDashes(arr);
    inp.value='';
    renderDashPanel();
  };
  $('#dashShareCurrent').onclick=function(){
    var list=gridList||cams;
    copyShareUrl(list, $('#dashShareCurrent'));
  };
}

// Grid
function buildGrid(list){
  if(!list) list=cams;
  GRID.innerHTML='';
  list.forEach(function(c){
    var card=TPL.cloneNode(true);
    var img=card.querySelector('img');
    img.src=bust(c.imageUrl);
    img.dataset.base=c.imageUrl;
    card.querySelector('figcaption').textContent=c.name;
    card.querySelector('figure').onclick=function(){ openModal(c); };
    GRID.appendChild(card);
  });
  observeGrid();
}

function observeGrid(){
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting) e.target.classList.add('isVis');
      else e.target.classList.remove('isVis');
    });
  },{threshold:0.1});
  GRID.querySelectorAll('img').forEach(function(i){ io.observe(i); });
}

function gridRefresh(){
  GRID.querySelectorAll('img.isVis').forEach(function(i){ i.src=bust(i.dataset.base); });
}

// Map
function initMap(){
  map=L.map(MAP_DIV);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
  cluster=L.markerClusterGroup();
  cams.forEach(function(c){
    if(!c.latitude) return;
    var m=L.circleMarker([c.latitude, c.longitude],{radius:6, color:accent(), fillColor:accent(), fillOpacity:1});
    m.on('click',function(){ openModal(c); });
    cluster.addLayer(m);
  });
  map.addLayer(cluster);
  var bb=cluster.getBounds();
  if(bb.isValid()) map.fitBounds(bb,{padding:[40,40], maxZoom:12});
  else map.setView([40.73,-73.94],11);
  map.on('moveend',function(){ updatePanel(); saveState(); });
  updatePanel();
}

function updatePanel(){
  var b=map.getBounds();
  currentSubset=cams.filter(function(c){ return c.latitude && b.contains([c.latitude,c.longitude]); });
  var html='<header>'+currentSubset.length+' cams <button id="showSubset">Grid</button></header><ul>';
  currentSubset.forEach(function(c){
    html+='<li data-id="'+(c.id||c.imageUrl)+'">'+c.name+'</li>';
  });
  html+='</ul>';
  PANEL.innerHTML=html;
  document.getElementById('showSubset').onclick=function(){ switchToGrid(currentSubset); };
  PANEL.querySelectorAll('li').forEach(function(li){
    li.onclick=function(){ openModal(findCam(li.dataset.id)); };
  });
}

function findCam(id){
  return cams.find(function(c){ return c.id==id||c.imageUrl==id; });
}

// Modal
function openModal(cam){
  currentCam=cam;
  MAP_DIV.classList.add('hidden');
  GRID.classList.remove('hidden');
  FSBTN.classList.remove('hidden');
  FSBTN.textContent='Full Screen';
  TOGGLE.textContent='Map ▸ Grid';
  M_IMG.src=bust(cam.imageUrl);
  M_NAME.textContent=cam.name;
  if(cam.latitude){
    M_LATLON.textContent=cam.latitude.toFixed(5)+', '+cam.longitude.toFixed(5);
  } else {
    M_LATLON.textContent='N/A';
  }
  M_TIME.textContent=new Date().toLocaleTimeString();
  setupMini();
  MODAL.classList.add('show');
  clearInterval(modalTimer);
  modalTimer=setInterval(function(){
    M_IMG.src=bust(currentCam.imageUrl);
    M_TIME.textContent=new Date().toLocaleTimeString();
  }, FPS);
}

function setupMini(){
  if(!mini){
    mini=L.map(META_MAP,{attributionControl:false, zoomControl:false, dragging:false, scrollWheelZoom:false});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(mini);
  }
  mini.eachLayer(function(l){ if(l instanceof L.CircleMarker||l instanceof L.Path) mini.removeLayer(l); });
  if(currentCam.latitude){
    L.circleMarker([currentCam.latitude,currentCam.longitude],{radius:7,color:'#fff',weight:2,fillColor:accent(),fillOpacity:1}).addTo(mini);
    currentSubset.forEach(function(o){
      if(o===currentCam) return;
      L.circleMarker([o.latitude,o.longitude],{radius:5,color:accent(),fillColor:accent(),fillOpacity:0.4}).addTo(mini);
    });
    mini.setView([currentCam.latitude,currentCam.longitude],16);
  }
  setTimeout(function(){ mini.invalidateSize(); },0);
}

function closeModal(){
  clearInterval(modalTimer);
  MODAL.classList.remove('show');
}
M_CLOSE.onclick=closeModal;
MODAL.onclick=function(e){ if(e.target===MODAL) closeModal(); };

function attachNearby(){
  document.querySelectorAll('.nearbyBtn').forEach(function(btn){
    btn.onclick=function(){
      if(!currentCam) return;
      var yard=parseInt(btn.dataset.yard,10);
      var near=cams.filter(function(c){ return c.latitude && (c===currentCam || hav(currentCam,c)<=yard*Y2M); });
      closeModal();
      switchToGrid(near);
    };
  });
}

function switchToGrid(list){
  gridList=list||cams;
  MAP_DIV.classList.add('hidden');
  GRID.classList.remove('hidden');
  TOGGLE.textContent='Map ▸ Grid';
  FSBTN.classList.remove('hidden');
  FSBTN.textContent='Full Screen';
  buildGrid(gridList);
  clearInterval(gridTimer);
  gridRefresh();
  gridTimer=setInterval(gridRefresh, FPS);
  saveState();
}

function switchToMap(){
  gridList=null;
  GRID.classList.add('hidden');
  MAP_DIV.classList.remove('hidden');
  TOGGLE.textContent='Grid ▸ Map';
  FSBTN.classList.add('hidden');
  clearInterval(gridTimer);
  map.setView([40.73,-73.94],11);
  map.invalidateSize();
  updatePanel();
  saveState();
}

TOGGLE.onclick=function(){
  if(GRID.classList.contains('hidden')) switchToGrid(currentSubset.length ? currentSubset : cams);
  else switchToMap();
};

SEARCH.oninput=function(e){
  var q=e.target.value.toLowerCase();
  GRID.querySelectorAll('figure.cam').forEach(function(f){
    f.classList.toggle('hidden', f.textContent.toLowerCase().indexOf(q)===-1);
  });
  PANEL.querySelectorAll('li').forEach(function(li){
    li.classList.toggle('hidden', li.textContent.toLowerCase().indexOf(q)===-1);
  });
};

FSBTN.onclick=function(){
  var fs=document.body.classList.toggle('fs');
  FSBTN.textContent=fs ? 'Exit Full Screen' : 'Full Screen';
  if(!fs) switchToGrid(gridList||cams);
};
