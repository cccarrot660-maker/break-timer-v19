
/* ENFORCE AUTH (PIN / session) */
(function(){
  try{
    const s = loadSettings()||{};
    const central = (window.__CENTRAL_GIST && window.__CENTRAL_GIST.token) ? true : false;
    // If session flag present and not expired, allow access
    const session = JSON.parse(localStorage.getItem('session_auth_v1') || 'null');
    if(session && session.expiresAt && Date.now() < session.expiresAt){
      // session valid
    } else {
      // no valid session: redirect to login unless we are already on login page
      if(window.location.pathname.indexOf('login.html')===-1){
        window.location.replace('login.html');
      }
    }
  }catch(e){ console.error(e); if(window.location.pathname.indexOf('login.html')===-1) window.location.replace('login.html'); }
})();
/* END ENFORCE AUTH */



/* CENTRAL GIST CONFIG SUPPORT */
try{
  window.APP_CONFIG = window.APP_CONFIG || {};
  // read config GIST token if provided in config.js
  const CENTRAL_GIST_TOKEN = window.APP_CONFIG.GIST_TOKEN || '';
  const CENTRAL_GIST_ID = window.APP_CONFIG.GIST_ID || '';
  // expose for other functions to use
  window.__CENTRAL_GIST = { token: CENTRAL_GIST_TOKEN, gistId: CENTRAL_GIST_ID };
}catch(e){ console.warn('No config.js found or parse error', e); }



/* ENFORCE AUTH (PIN / session) */
// Ensure app requires Google login: if no googleUser present, redirect to login.html
(function(){
  try{
    const s = loadSettings();
    const central = (window.__CENTRAL_GIST && window.__CENTRAL_GIST.token) ? true : false;
    if(!central && (!s || !s.googleUser || !s.googleUser.email)){
      if(window.location.pathname.indexOf('login.html')===-1){
        window.location.replace('login.html');
      }
    }
  }catch(e){}
})();
/* END ENFORCE GOOGLE-ONLY ACCESS */


// app.js V11 PRO - improved and cleaned for hosting
(function(){
  'use strict';
  const qs = s=>document.querySelector(s);
  const STORAGE_KEY = 'bt_v11_logs', SSET_KEY='bt_v11_settings';
  // Elements
  const timeLarge = qs('#timeLarge'), timerLabel = qs('#timerLabel'), timeInfo = qs('#timeInfo');
  const startBtn = qs('#startBtn'), pauseBtn = qs('#pauseBtn'), endBtn = qs('#endBtn');
  const modeSelect = qs('#modeSelect'), limitMinutesEl = qs('#limitMinutes'), warnBeforeEl = qs('#warnBefore');
  const soundToggle = qs('#soundToggle');
  const manualToggle = qs('#manualToggle'), manualForm = qs('#manualForm');
  const manualSave = qs('#manualSave'), manualCancel = qs('#manualCancel');
  const logsBody = qs('#logsTable tbody');
  const sumTodayEl = qs('#sumToday'), sumWeekEl = qs('#sumWeek'), sumAllEl = qs('#sumAll');
  const tgResult = qs('#tgResult'), tgDebug = qs('#tgDebug');
  const dailyTargetInput = qs('#dailyTargetInput');

  let interval=null, running=false, startTime=null, pausedAt=null, elapsedPaused=0;
  let currentLogIndex=null, nearWarnSentIndex=null;
  let chart=null;

  // small sound
  const ding = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=');

  function loadSettings(){ try{return JSON.parse(localStorage.getItem(SSET_KEY)||'{}'); }catch(e){return {}; } }
  function saveSettings(s){ try{ localStorage.setItem(SSET_KEY, JSON.stringify(s||{})); }catch(e){} }
  function loadLogs(){ try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); }catch(e){return []; } }
  function saveLogs(v){ localStorage.setItem(STORAGE_KEY, JSON.stringify(v||[])); }

  function nowISO(){ return new Date().toISOString(); }
  function fmtLocal(iso){ return iso ? new Date(iso).toLocaleString('th-TH') : '-'; }
  function secs(s,e){ if(!s) return 0; const st=new Date(s), ed=e?new Date(e):new Date(); return Math.max(0, Math.floor((ed-st)/1000)); }

  // Telegram sender with optional proxy
  async function sendTelegram(token, chatId, text){
    const proxy = (qs('#proxyUrl') ? qs('#proxyUrl').value.trim() : '');
    try{
      if(proxy){
        const r = await fetch(proxy, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({token, chatId, text})});
        const txt = await r.text().catch(()=>null);
        if(!r.ok) throw new Error('proxy HTTP '+r.status+' '+(txt||''));
        return {ok:true};
      } else {
        const r = await fetch('https://api.telegram.org/bot'+token+'/sendMessage', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({chat_id:chatId, text, parse_mode:'HTML'})});
        const j = await r.json().catch(()=>null);
        if(!r.ok) return {ok:false, status:r.status, detail:j};
        if(j && j.ok) return {ok:true};
        return {ok:false, detail:j};
      }
    }catch(e){ return {ok:false, error:e.message}; }
  }

  function updateDisplay(){
    if(!running && !startTime){ timeLarge.textContent='00:00:00'; timerLabel.textContent='สถานะ: พร้อม'; timeInfo.textContent='ไม่มีการจับเวลา'; return; }
    let total = 0;
    if(startTime) total = Math.floor((Date.now() - new Date(startTime).getTime() - elapsedPaused)/1000);
    const h = String(Math.floor(total/3600)).padStart(2,'0'), m = String(Math.floor((total%3600)/60)).padStart(2,'0'), s = String(total%60).padStart(2,'0');
    timeLarge.textContent = `${h}:${m}:${s}`;
    timerLabel.textContent = `สถานะ: ${running?modeSelect.value:'หยุดชั่วคราว'}`;
    timeInfo.textContent = `เริ่ม: ${fmtLocal(startTime)} • ผ่านไป ${Math.round(total/60)} นาที`;
    // smart and near-end
    smartChecks(total);
    try{ checkNearEnd(total); }catch(e){ console.error(e); }
  }

  let warned=false, alerted=false;
  function smartChecks(totalSec){
    const limit = Number(limitMinutesEl.value||30); const warn = Number(warnBeforeEl.value||5);
    if(!warned && totalSec >= Math.max(0,(limit-warn)*60) && totalSec < limit*60){ warned=true; quickNotify('เตือนใกล้หมด',`เหลือประมาณ ${warn} นาที`); }
    if(!alerted && totalSec >= limit*60){ alerted=true; quickNotify('ครบเวลา',`ครบ ${limit} นาที`); }
  }
  function quickNotify(title, body){
    if(window.Notification && Notification.permission==='granted') new Notification(title, {body});
    else if(window.Notification && Notification.permission!=='denied') Notification.requestPermission();
    if(soundToggle && soundToggle.checked){ try{ ding.play().catch(()=>{}); }catch(e){} }
    if(tgResult) tgResult.textContent = title + ' — ' + body;
  }

  // near-end per round
  async function checkNearEnd(totalSec){
    const nearChk = qs('#sendNearNotif'); if(!nearChk || !nearChk.checked) return;
    if(currentLogIndex==null) return;
    const logs = loadLogs(); if(currentLogIndex<0 || currentLogIndex>=logs.length) return;
    if(nearWarnSentIndex===currentLogIndex) return;
    const entry = logs[currentLogIndex]; if(!entry || entry.end) return;
    const limit = Number(limitMinutesEl.value||30); const warn = Number(warnBeforeEl.value||5);
    const remain = Math.max(0, limit*60 - totalSec); const remainMin = Math.ceil(remain/60);
    if(remain>0 && remain <= warn*60){
      const token = (qs('#tgToken').value||'').trim(); const chatId = (qs('#tgChatId').value||'').trim();
      if(!token||!chatId){ tgResult.textContent='ยังไม่ได้ตั้งค่า Bot Token/Chat ID'; return; }
      const usedMin = Math.round(totalSec/60);
      const msg = `<b>เตือนใกล้ครบ</b>
ประเภท: ${entry.type}
เริ่ม: ${fmtLocal(entry.start)}
ใช้เวลา: ${usedMin} นาที
เวลาเหลือประมาณ: ${remainMin} นาที`;
      tgResult.textContent='กำลังส่งแจ้งเตือนใกล้หมด...';
      const res = await sendTelegram(token, chatId, msg);
      if(res.ok){ tgResult.textContent='ส่ง near-end สำเร็จ ✨'; tgDebug.textContent=''; nearWarnSentIndex = currentLogIndex; }
      else { tgResult.textContent='ส่ง near-end ไม่สำเร็จ'; tgDebug.textContent = JSON.stringify(res); }
    }
  }

  // start/pause/end handlers
  startBtn.addEventListener('click', async function(){
    try{
      if(running) return;
      if(!startTime){ startTime = nowISO(); elapsedPaused=0; warned=false; alerted=false; }
      else if(pausedAt){ const pd=Date.now()-new Date(pausedAt).getTime(); elapsedPaused += pd; pausedAt=null; }
      running=true; updateDisplay(); interval=setInterval(updateDisplay,1000);
      const logs = loadLogs(); logs.push({type:modeSelect.value, start:startTime, end:null, note:''}); saveLogs(logs);
      currentLogIndex = logs.length-1; nearWarnSentIndex = null; renderLogs(); updateStats();
      // send start telegram
      const sendStart = qs('#sendStartNotif') && qs('#sendStartNotif').checked;
      if(sendStart){
        const token=(qs('#tgToken').value||'').trim(), chatId=(qs('#tgChatId').value||'').trim();
        if(!token||!chatId){ tgResult.textContent='ยังไม่ได้ตั้งค่า Bot Token/Chat ID'; return; }
        const roundLimit = Number(limitMinutesEl.value||30);
        const msg = `<b>เริ่ม${modeSelect.value}</b>
ประเภท: ${modeSelect.value}
เริ่ม: ${fmtLocal(startTime)}
ใช้เวลา: 0 นาที
เวลามีเหลือ: ${roundLimit} นาที`;
        tgResult.textContent='ส่งแจ้งเตือนเริ่ม...'; const r = await sendTelegram(token, chatId, msg);
        if(r.ok){ tgResult.textContent='ส่งเริ่มสำเร็จ ✨'; tgDebug.textContent=''; } else { tgResult.textContent='ส่งเริ่มไม่สำเร็จ'; tgDebug.textContent=JSON.stringify(r); }
      }
    }catch(e){ console.error(e); tgResult.textContent='เกิดข้อผิดพลาดขณะเริ่ม'; tgDebug.textContent=e.message; }
  });

  pauseBtn.addEventListener('click', function(){ if(!startTime) return; if(running){ running=false; pausedAt=nowISO(); clearInterval(interval); updateDisplay(); } else { if(pausedAt){ const pd=Date.now()-new Date(pausedAt).getTime(); elapsedPaused+=pd; pausedAt=null; running=true; interval=setInterval(updateDisplay,1000); } } });

  endBtn.addEventListener('click', async function(){
    try{
      if(!startTime) return;
      const logs = loadLogs(); let finished=null;
      for(let i=logs.length-1;i>=0;i--){ if(!logs[i].end){ logs[i].end = nowISO(); finished = logs[i]; break; } }
      saveLogs(logs); running=false; startTime=null; pausedAt=null; elapsedPaused=0; clearInterval(interval); updateDisplay(); renderLogs(); updateStats();
      const sendEnd = qs('#sendEndNotif') && qs('#sendEndNotif').checked;
      if(sendEnd){
        const token=(qs('#tgToken').value||'').trim(), chatId=(qs('#tgChatId').value||'').trim();
        if(!token||!chatId){ tgResult.textContent='ยังไม่ได้ตั้งค่า Bot Token/Chat ID'; return; }
        if(!finished){ tgResult.textContent='ไม่พบบันทึกที่จบ'; currentLogIndex=null; return; }
        const usedSec = secs(finished.start, finished.end); const usedMin = Math.round(usedSec/60);
        const limit = Number(limitMinutesEl.value||30); const remain = Math.max(0, limit - usedMin);
        const durH = Math.floor(usedSec/3600), durM = Math.floor((usedSec%3600)/60), durS = usedSec%60;
        const dur = (durH>0?durH+' ช.ม ':'') + durM + ' นาที ' + durS + ' วินาที';
        const msg = `<b>จบ${finished.type}</b>
ประเภท: ${finished.type}
เริ่ม: ${fmtLocal(finished.start)}
จบ: ${fmtLocal(finished.end)}
ใช้เวลา: ${usedMin} นาที
เวลาเหลือจากลิมิตรอบ: ${remain} นาที
(สรุป: ${dur})`;
        tgResult.textContent='ส่งแจ้งเตือนจบ...'; const r = await sendTelegram(token, chatId, msg);
        if(r.ok){ tgResult.textContent='ส่งจบสำเร็จ ✨'; tgDebug.textContent=''; nearWarnSentIndex=null; currentLogIndex=null; } else { tgResult.textContent='ส่งจบไม่สำเร็จ'; tgDebug.textContent=JSON.stringify(r); }
      }
    }catch(e){ console.error(e); tgResult.textContent='เกิดข้อผิดพลาดขณะจบ'; tgDebug.textContent=e.message; }
  });

  // Manual form
  qs('#manualToggle').addEventListener('click', ()=>{ if(manualForm) manualForm.classList.toggle('hidden'); });
  manualSave.addEventListener('click', ()=>{
    const t = (qs('#manualType').value||'พัก'), s = qs('#manualStart').value, e = qs('#manualEnd').value;
    if(!s){ alert('กรุณาระบุเวลาเริ่ม'); return; } if(e && new Date(e) < new Date(s)){ alert('เวลาจบต้องมากกว่าเวลาเริ่ม'); return; }
    const logs = loadLogs(); logs.push({type:t, start:new Date(s).toISOString(), end:e?new Date(e).toISOString():null, note: qs('#manualNote').value||''}); saveLogs(logs); renderLogs(); updateStats();
    qs('#manualType').value=''; qs('#manualStart').value=''; qs('#manualEnd').value=''; qs('#manualNote').value=''; manualForm.classList.add('hidden');
  });
  manualCancel.addEventListener('click', ()=>{ qs('#manualType').value=''; qs('#manualStart').value=''; qs('#manualEnd').value=''; qs('#manualNote').value=''; manualForm.classList.add('hidden'); });

  // render logs
  function renderLogs(filterStart, filterEnd){
    const logs = loadLogs().slice().reverse(); logsBody.innerHTML='';
    const fs = filterStart? new Date(filterStart+'T00:00:00') : null; const fe = filterEnd? new Date(filterEnd+'T23:59:59') : null;
    logs.forEach(l=>{ const st = new Date(l.start); if(fs && st<fs) return; if(fe && st>fe) return; const tr = document.createElement('tr'); const mins = Math.round(secs(l.start,l.end)/60); tr.innerHTML = `<td>${l.type||''}</td><td>${fmtLocal(l.start)}</td><td>${l.end?fmtLocal(l.end):'-'}</td><td>${mins}</td>`; logsBody.appendChild(tr); });
  }

  // stats + chart
  function updateStats(){ const logs = loadLogs(); const today=new Date(); today.setHours(0,0,0,0); const weekStart=new Date(); weekStart.setDate(weekStart.getDate()-6); weekStart.setHours(0,0,0,0); let sumToday=0, sumWeek=0, sumAll=0; const daily={}; for(const l of logs){ const mins=Math.round(secs(l.start,l.end)/60); if(!isFinite(mins)||mins<=0) continue; const st=new Date(l.start); const k=st.toISOString().slice(0,10); daily[k]=(daily[k]||0)+mins; sumAll+=mins; if(st>=today) sumToday+=mins; if(st>=weekStart) sumWeek+=mins; } sumTodayEl.textContent = sumToday; sumWeekEl.textContent = sumWeek; sumAllEl.textContent = sumAll; const dt = Number(dailyTargetInput.value||60); if(dt>0 && sumToday>=dt){ timerLabel.textContent='สถานะ: บรรลุเป้ารายวัน 🎯'; if(window.Notification && Notification.permission!=='denied') Notification.requestPermission().then(p=>{ if(p==='granted') new Notification('เป้ารายวันสำเร็จ 🎉',{body:'ครบเป้ารายวันแล้ว'}); }); } const labels=[]; const data=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=d.toISOString().slice(0,10); labels.push(k); data.push(daily[k]||0); } if(chart){ chart.data.labels=labels; chart.data.datasets[0].data=data; chart.update(); } else { chart = new Chart(qs('#chartDaily').getContext('2d'), {type:'bar', data:{labels, datasets:[{label:'นาที/วัน', data, backgroundColor:'#7c3aed'}]}, options:{responsive:true, plugins:{legend:{display:false}}}}); } 
    // update progress bar & big today label
    try{
      const sumTodayBigEl = qs('#sumTodayLarge');
      const bar = qs('#sumTodayBar');
      const dtLabel = qs('#dailyTargetLabel');
      const dtVal = Number(dailyTargetInput.value||60);
      if(sumTodayBigEl) sumTodayBigEl.textContent = sumToday;
      if(dtLabel) dtLabel.textContent = dtVal;
      if(bar){
        const pct = dtVal>0 ? Math.min(100, Math.round((sumToday/dtVal)*100)) : 0;
        bar.style.width = pct + '%';
        bar.setAttribute('aria-valuenow', pct);
      }
    }catch(e){ console.error('progress update err', e); }
  }

  qs('#applyFilter').addEventListener('click', ()=>{ renderLogs(qs('#filterStart').value, qs('#filterEnd').value); });
  qs('#clearAll').addEventListener('click', ()=>{ if(confirm('ลบบันทึกทั้งหมด?')){ localStorage.removeItem(STORAGE_KEY); renderLogs(); updateStats(); } });
  qs('#exportCsv').addEventListener('click', ()=>{ const logs=loadLogs(); if(!logs.length){ alert('ไม่มีข้อมูล'); return; } const header=['ประเภท','เริ่ม','จบ','นาที']; const rows=logs.map(l=>[l.type,l.start,l.end||'',Math.round(secs(l.start,l.end)/60)]); const csv=[header,...rows].map(r=>r.map(c=>`"${(''+(c||'')).replace(/"/g,'""')}"`).join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='break_logs_v11.csv'; a.click(); URL.revokeObjectURL(url); });

  // test tg
  qs('#testTg').addEventListener('click', async ()=>{ const token=(qs('#tgToken').value||'').trim(), chatId=(qs('#tgChatId').value||'').trim(), proxy=(qs('#proxyUrl').value||'').trim(); if(!token||!chatId){ alert('กรุณาใส่ Bot Token และ Chat ID'); return; } const txt = '<b>ทดสอบจาก gxHo Break-Timer — NOAH345 💜 V11 PRO</b>'; try{ let res; if(proxy){ res = await fetch(proxy,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,chatId,text:txt})}); } else { res = await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:txt,parse_mode:'HTML'})}); } if(res && res.ok){ tgResult.textContent='ส่งสำเร็จ ✨'; tgDebug.textContent=''; } else { tgResult.textContent='ส่งไม่สำเร็จ — ตรวจสอบค่าและ CORS'; tgDebug.textContent = res?('HTTP '+res.status):'no response'; } }catch(e){ tgResult.textContent = 'เกิดข้อผิดพลาด: '+e.message; tgDebug.textContent = e.stack||e.message; } });

  // dark toggle and init
  qs('#darkToggle').addEventListener('click', ()=>{ document.body.classList.toggle('dark'); try{ localStorage.setItem('bt_v11_dark', document.body.classList.contains('dark')?'1':'0'); }catch(e){} });
  if(localStorage.getItem('bt_v11_dark')==='1') document.body.classList.add('dark');
  dailyTargetInput.addEventListener('change', ()=>{ try{ const s={}; s.dailyTarget = Number(dailyTargetInput.value||60); saveSettings(s); updateStats(); }catch(e){} });

  // restore running session
  function init(){ renderLogs(); updateStats(); const logs = loadLogs(); for(let i=logs.length-1;i>=0;i--){ if(!logs[i].end){ startTime = logs[i].start; running=true; currentLogIndex=i; interval=setInterval(updateDisplay,1000); break; } } updateDisplay(); }
  init();

  function nowISO(){ return new Date().toISOString(); }

})();

// ---- Added Daily Remaining + Telegram Notify ----

// notify when daily remaining <= 110
async function notifyDailyRemaining(remain, target){
  const token = (qs('#tgToken').value||'').trim();
  const chatId = (qs('#tgChatId').value||'').trim();
  if(!token||!chatId) return;
  const msg = `<b>แจ้งเตือนเวลาคงเหลือรายวัน</b>
เวลาคงเหลือ: ${remain} นาที
เป้าวันนี้: ${target} นาที`;
  try{
    await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text:msg,parse_mode:'HTML'})
    });
  }catch(e){console.error(e);}
}

// send summary on end button
async function sendDailySummary(){
  const token=(qs('#tgToken').value||'').trim();
  const chatId=(qs('#tgChatId').value||'').trim();
  if(!token||!chatId) return;
  const dailyTarget=Number(dailyTargetInput.value||120);
  const logs=loadLogs();
  let sumToday=0;
  const today=new Date(); today.setHours(0,0,0,0);
  logs.forEach(l=>{
    const st=new Date(l.start);
    if(st>=today){
      const mins=Math.round(secs(l.start,l.end)/60);
      if(mins>0) sumToday+=mins;
    }
  });
  const remain=Math.max(0,dailyTarget-sumToday);
  const msg = `<b>สรุปเวลาทั้งหมดวันนี้</b>
ใช้ไปแล้ว: ${sumToday} นาที
เวลาคงเหลือ: ${remain} นาที
เป้าวันนี้: ${dailyTarget} นาที`;
  try{
    await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text:msg,parse_mode:'HTML'})
    });
  }catch(e){console.error(e);}
}



// --- Ensure robust saving: saveAllSettings + beforeunload ---
function getSettingsFromUI(){
  const s = loadSettings() || {};
  s.tgToken = (qs('#tgToken') && qs('#tgToken').value) || s.tgToken || '';
  s.tgChatId = (qs('#tgChatId') && qs('#tgChatId').value) || s.tgChatId || '';
  s.proxyUrl = (qs('#proxyUrl') && qs('#proxyUrl').value) || s.proxyUrl || '';
  s.dailyTarget = Number((qs('#dailyTargetInput') && qs('#dailyTargetInput').value) || s.dailyTarget || 0);
  s.limitMinutes = Number((qs('#limitMinutes') && qs('#limitMinutes').value) || s.limitMinutes || 0);
  s.warnBefore = Number((qs('#warnBefore') && qs('#warnBefore').value) || s.warnBefore || 0);
  // optional notification toggles
  const startChk = qs('#sendStartNotif'); if(startChk) s.sendStartNotif = !!startChk.checked;
  const nearChk = qs('#sendNearNotif'); if(nearChk) s.sendNearNotif = !!nearChk.checked;
  const endChk = qs('#sendEndNotif'); if(endChk) s.sendEndNotif = !!endChk.checked;
  return s;
}

function saveAllSettings(){
  try{
    const s = getSettingsFromUI();
    saveSettings(s);
    // also mirror to console for debug
    console.debug('Settings saved', s);
  }catch(e){ console.error('saveAllSettings err', e); }
}

// auto-save on inputs (more aggressive)
function attachAutoSave(){
  const inputs = document.querySelectorAll('#tgToken, #tgChatId, #proxyUrl, #dailyTargetInput, #limitMinutes, #warnBefore, #sendStartNotif, #sendNearNotif, #sendEndNotif');
  inputs.forEach(el=>{
    if(!el) return;
    // save on input and change to catch typing and toggles
    el.addEventListener('input', saveAllSettings);
    el.addEventListener('change', saveAllSettings);
  });
  // save when clicking the provided save button as well
  const saveBtn = qs('#saveSettingsBtn');
  if(saveBtn){ saveBtn.addEventListener('click', saveAllSettings); }
}

// ensure we save one last time before leaving/reloading
window.addEventListener('beforeunload', ()=>{
  try{ saveAllSettings(); }catch(e){}
});

// call attachAutoSave after DOM content loaded (in case called earlier)
document.addEventListener('DOMContentLoaded', ()=>{
  // ensure settings applied first
  try{ applySettingsToUI(); }catch(e){}
  // attach auto save listeners
  try{ attachAutoSave(); }catch(e){}
});
// --- end robust save additions ---




/* ---------- Google Sign-In (drive + profile) ----------
// Adds sign-in/out UI, gets access token and user profile (email/name),
// stores user info in settings, and uses same token for Drive save/load.
------------------------------------------------------*/
let gsiClientInitialized = false;

function initGisForDrive(clientId){
  if(gsiClientInitialized) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
    callback: (resp) => {
      if(resp && resp.access_token){
        gapiAccessToken = resp.access_token;
        gapi.client.setToken({ access_token: gapiAccessToken });
        // fetch userinfo
        fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: 'Bearer ' + gapiAccessToken }
        }).then(r=>r.json()).then(profile=>{
          const s = loadSettings()||{};
          s.googleUser = { email: profile.email, name: profile.name, sub: profile.sub };
          saveSettings(s);
          // update UI
          const info = qs('#gUserInfo');
          if(info) info.textContent = 'Signed in: ' + (profile.email || profile.name);
          const out = qs('#gSignOutBtn'); if(out) out.style.display = 'inline-block';
          const inb = qs('#gSignInBtn'); if(inb) inb.style.display = 'none';
        }).catch(e=>console.error('userinfo err', e));
      }
    }
  });
  gsiClientInitialized = true;
}

function signOutGoogle(){
  try{
    // revoke token (best-effort)
    if(gapiAccessToken){
      fetch('https://oauth2.googleapis.com/revoke?token=' + gapiAccessToken, { method:'POST', headers:{ 'content-type':'application/x-www-form-urlencoded' } });
    }
  }catch(e){}
  gapiAccessToken = '';
  const s = loadSettings()||{}; delete s.googleUser; saveSettings(s);
  const info = qs('#gUserInfo'); if(info) info.textContent = '';
  const out = qs('#gSignOutBtn'); if(out) out.style.display = 'none';
  const inb = qs('#gSignInBtn'); if(inb) inb.style.display = 'inline-block';
  alert('Signed out');
}

// override initGis to also set up sign-in UI if called elsewhere
function ensureGisAndGapi(clientId){
  if(!gapiInited){
    // load gapi client then init
    return loadGapiClient().then(()=>{
      initGis(clientId);
      initGisForDrive(clientId);
    });
  }else{
    initGis(clientId);
    initGisForDrive(clientId);
    return Promise.resolve();
  }
}

// modify saveToDriveFlow and loadFromDriveFlow to ensure sign-in used
// We'll wrap existing functions to require sign-in if clientId provided.
const _origSaveToDriveFlow = saveToDriveFlow;
const _origLoadFromDriveFlow = loadFromDriveFlow;

async function saveToDriveWithSignIn(clientId){
  try{
    await ensureGisAndGapi(clientId);
    // request token (will open consent if needed)
    await requestGisToken();
    // set UI sign-in state using token callback above (userinfo fetched there)
    // now call original save function which relies on gapiAccessToken being set
    return await _origSaveToDriveFlow(clientId);
  }catch(e){
    console.error('saveToDriveWithSignIn err', e);
    alert('ไม่สามารถ sign in หรือ save: ' + e.message);
  }
}

async function loadFromDriveWithSignIn(clientId){
  try{
    await ensureGisAndGapi(clientId);
    await requestGisToken();
    return await _origLoadFromDriveFlow(clientId);
  }catch(e){
    console.error('loadFromDriveWithSignIn err', e);
    alert('ไม่สามารถ sign in หรือ load: ' + e.message);
  }
}

/* Wire up Sign-in buttons */
document.addEventListener('DOMContentLoaded', ()=>{
  const inb = qs('#gSignInBtn'), out = qs('#gSignOutBtn'), info = qs('#gUserInfo');
  const s = loadSettings()||{};
  // show existing user if present
  if(s.googleUser && s.googleUser.email){
    if(info) info.textContent = 'Signed in: ' + s.googleUser.email;
    if(out) out.style.display = 'inline-block';
    if(inb) inb.style.display = 'none';
  }
  if(inb) inb.addEventListener('click', async ()=>{
    const clientId = s.googleClientId || (qs('#googleClientId') && qs('#googleClientId').value) || prompt('ใส่ Google OAuth Client ID (Web application):');
    if(!clientId) return alert('ต้องมี client id');
    s.googleClientId = clientId; saveSettings(s);
    try{
      await ensureGisAndGapi(clientId);
      // request token (consent)
      await requestGisToken();
      // token callback will update UI
    }catch(e){
      console.error(e); alert('Sign-in failed: ' + e.message);
    }
  });
  if(out) out.addEventListener('click', ()=> signOutGoogle());

  // override Drive buttons to use sign-in flow when available
  const sd = qs('#saveToDrive'), ld = qs('#loadFromDrive');
  if(sd) sd.addEventListener('click', async ()=>{
    const clientId = s.googleClientId || (qs('#googleClientId') && qs('#googleClientId').value) || prompt('ใส่ Google OAuth Client ID (Web application):');
    if(!clientId) return alert('ต้องมี client id');
    s.googleClientId = clientId; saveSettings(s);
    await saveToDriveWithSignIn(clientId);
  });
  if(ld) ld.addEventListener('click', async ()=>{
    const clientId = s.googleClientId || (qs('#googleClientId') && qs('#googleClientId').value) || prompt('ใส่ Google OAuth Client ID (Web application):');
    if(!clientId) return alert('ต้องมี client id');
    s.googleClientId = clientId; saveSettings(s);
    await loadFromDriveWithSignIn(clientId);
  });
});


/* ---------- End Google Sign-In additions ---------- */


 
// ---------- Drive: per-user filename, appDataFolder, auto-sync, and public sharing ----------

// helper: compute filename from settings/googleUser
function getDriveFileName(){
  const s = loadSettings()||{};
  const user = s.googleUser && s.googleUser.email ? s.googleUser.email.replace(/[@.]/g,'_') : null;
  const base = 'breaker_sync';
  return user ? `${base}_${user}.json` : `${base}.json`;
}

// find file in appDataFolder or drive root depending on useAppDataFolder flag
async function findDriveFileAdaptive(useAppDataFolder){
  // use appDataFolder: query for name and parents in 'appDataFolder'
  if(useAppDataFolder){
    const name = getDriveFileName();
    const res = await gapi.client.drive.files.list({
      q: `name='${name}' and trashed=false and 'appDataFolder' in parents`,
      spaces: 'appDataFolder',
      fields: 'files(id,name,modifiedTime)',
      pageSize: 10
    });
    const files = res.result.files || [];
    return files[0] || null;
  }else{
    const name = getDriveFileName();
    const res = await gapi.client.drive.files.list({
      q: `name='${name}' and trashed=false`,
      spaces: 'drive',
      fields: 'files(id,name,modifiedTime)',
      pageSize: 10
    });
    const files = res.result.files || [];
    return files[0] || null;
  }
}

// create file in appDataFolder or root
async function createDriveFileAdaptive(content, useAppDataFolder){
  const name = getDriveFileName();
  const metadata = { name: name, mimeType: 'application/json' };
  if(useAppDataFolder){
    metadata.parents = ['appDataFolder'];
  }
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + gapiAccessToken },
    body: form
  });
  if(!r.ok) throw new Error('Drive upload error ' + r.status);
  return r.json();
}

// update file
async function updateDriveFileAdaptive(fileId, content){
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + gapiAccessToken, 'Content-Type':'application/json' },
    body: JSON.stringify(content)
  });
  if(!r.ok) throw new Error('Drive update error ' + r.status);
  return r.json();
}

// set permission to anyone with link (role: reader)
async function makeFilePublic(fileId){
  const r = await gapi.client.drive.permissions.create({
    fileId: fileId,
    resource: { role: 'reader', type: 'anyone' }
  });
  return r;
}

// Enhanced saveToDriveFlow: respects useAppDataFolder and sharePublic
async function saveToDriveFlow(clientId){
  try{
    // lazy init gapi & gis
    if(!gapiInited) await loadGapiClient();
    if(!tokenClient) initGis(clientId);
    await requestGisToken();
    const s = loadSettings()||{};
    const useApp = !!(s.useAppDataFolder || (qs('#useAppDataFolder') && qs('#useAppDataFolder').checked));
    const sharePublic = !!(s.sharePublic || (qs('#sharePublic') && qs('#sharePublic').checked));
    const payload = getAllDataForSync();
    const existing = await findDriveFileAdaptive(useApp);
    if(existing){
      if(!confirm('อัปเดตไฟล์บน Google Drive (จะทับไฟล์เดิม) ต้องการดำเนินการต่อหรือไม่?')) return;
      const upd = await updateDriveFileAdaptive(existing.id, payload);
      // save driveFileId in settings
      const s2 = loadSettings()||{}; s2.driveFileId = existing.id; s2.useAppDataFolder = useApp; s2.sharePublic = sharePublic; saveSettings(s2);
      if(sharePublic){
        try{ await makeFilePublic(existing.id); }catch(e){ console.warn('makeFilePublic failed', e); }
      }
      alert('บันทึกลง Google Drive เรียบร้อย ✨');
    }else{
      const res = await createDriveFileAdaptive(payload, useApp);
      const s2 = loadSettings()||{}; s2.driveFileId = res.id; s2.useAppDataFolder = useApp; s2.sharePublic = sharePublic; saveSettings(s2);
      if(sharePublic){
        try{ await makeFilePublic(res.id); }catch(e){ console.warn('makeFilePublic failed', e); }
      }
      alert('สร้างไฟล์บน Google Drive เรียบร้อย ✨');
    }
  }catch(e){ console.error(e); alert('Save to Drive failed: ' + e.message); }
}

// Enhanced loadFromDriveFlow: adaptive
async function loadFromDriveFlow(clientId){
  try{
    if(!gapiInited) await loadGapiClient();
    if(!tokenClient) initGis(clientId);
    await requestGisToken();
    const s = loadSettings() || {};
    const useApp = !!(s.useAppDataFolder || (qs('#useAppDataFolder') && qs('#useAppDataFolder').checked));
    const existing = await findDriveFileAdaptive(useApp);
    if(!existing) return alert('ไม่พบไฟล์บน Google Drive ที่ตรงกับชื่อผู้ใช้ของคุณ');
    if(!confirm('จะโหลดไฟล์จาก Google Drive ที่พบ (อาจทับข้อมูลปัจจุบัน) ดำเนินการต่อไหม?')) return;
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${existing.id}?alt=media`, {
      headers: { Authorization: 'Bearer ' + gapiAccessToken }
    });
    if(!r.ok) throw new Error('Drive file fetch error ' + r.status);
    const obj = await r.json();
    applyAllDataFromSync(obj);
    const s2 = loadSettings()||{}; s2.driveFileId = existing.id; s2.useAppDataFolder = useApp; saveSettings(s2);
    alert('โหลดจาก Google Drive เรียบร้อย ✨');
  }catch(e){
    console.error(e); alert('Load from Drive failed: ' + e.message);
  }
}

// Auto-sync: interval handling
let autoSyncTimer = null;
function startAutoSync(minutes){
  stopAutoSync();
  const ms = Math.max(1, Number(minutes||10)) * 60 * 1000;
  autoSyncTimer = setInterval(async ()=>{
    const s = loadSettings()||{};
    const clientId = s.googleClientId || (qs('#googleClientId') && qs('#googleClientId').value);
    if(!clientId){ console.warn('Auto-sync: no clientId'); return; }
    try{
      await saveToDriveWithSignIn(clientId);
      console.debug('Auto-sync completed at', new Date().toISOString());
    }catch(e){ console.warn('Auto-sync error', e); }
  }, ms);
  const btn = qs('#toggleAutoSync'); if(btn) btn.textContent = 'Stop Auto-sync';
  // save setting
  const s = loadSettings()||{}; s.autoSyncMinutes = minutes; s.autoSyncEnabled = true; saveSettings(s);
}

function stopAutoSync(){
  if(autoSyncTimer){ clearInterval(autoSyncTimer); autoSyncTimer = null; }
  const btn = qs('#toggleAutoSync'); if(btn) btn.textContent = 'Start Auto-sync';
  const s = loadSettings()||{}; s.autoSyncEnabled = false; saveSettings(s);
}

// Wire up auto-sync controls on DOM load
document.addEventListener('DOMContentLoaded', ()=>{
  const toggle = qs('#toggleAutoSync');
  const input = qs('#autoSyncMinutes');
  // initialize from settings
  const s = loadSettings()||{};
  if(input && s.autoSyncMinutes) input.value = s.autoSyncMinutes;
  if(s.autoSyncEnabled && s.autoSyncMinutes){
    startAutoSync(s.autoSyncMinutes);
  }
  if(toggle){
    toggle.addEventListener('click', ()=>{
      const mins = input ? Number(input.value||10) : 10;
      if(autoSyncTimer) stopAutoSync(); else startAutoSync(mins);
    });
  }
  // save checkbox states into settings when changed
  const useAppChk = qs('#useAppDataFolder'), shareChk = qs('#sharePublic');
  if(useAppChk) useAppChk.addEventListener('change', ()=> { const ss=loadSettings()||{}; ss.useAppDataFolder = !!useAppChk.checked; saveSettings(ss); });
  if(shareChk) shareChk.addEventListener('change', ()=> { const ss=loadSettings()||{}; ss.sharePublic = !!shareChk.checked; saveSettings(ss); });
});



/* ---------- Client-side encryption (Web Crypto) + Anonymous Gist flows ----------
// Uses PBKDF2 to derive AES-GCM key from PIN/password, encrypts JSON payload,
// creates anonymous gist (no token) or uses provided gist id to PUT content.
// Note: anonymous gist creation via GitHub API is possible without auth (creates anonymous gist)
--------------------------------------------------*/
async function deriveKeyFromPassword(password, saltStr){
  const enc = new TextEncoder();
  const salt = saltStr ? enc.encode(saltStr) : crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), {name:'PBKDF2'}, false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({
    name: 'PBKDF2',
    salt: salt,
    iterations: 250000,
    hash: 'SHA-256'
  }, baseKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt','decrypt']);
  return { key, salt };
}

async function encryptJSON(obj, password){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const saltRand = crypto.getRandomValues(new Uint8Array(16));
  const saltStr = Array.from(saltRand).map(n=>('00'+n.toString(16)).slice(-2)).join('');
  const { key, salt } = await deriveKeyFromPassword(password, saltStr);
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name:'AES-GCM', iv: iv }, key, data);
  // return base64 components
  function b64(u8){ return btoa(String.fromCharCode.apply(null, new Uint8Array(u8))); }
  return {
    iv: b64(iv),
    salt: saltStr,
    ciphertext: b64(cipher)
  };
}

async function decryptJSON(encObj, password){
  try{
    const dec = new TextDecoder();
    function fromB64(s){ const bin = atob(s); const len = bin.length; const arr = new Uint8Array(len); for(let i=0;i<len;i++) arr[i]=bin.charCodeAt(i); return arr; }
    const iv = fromB64(encObj.iv);
    const cipher = fromB64(encObj.ciphertext);
    const saltStr = encObj.salt;
    const { key } = await deriveKeyFromPassword(password, saltStr);
    const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv: iv }, key, cipher);
    return JSON.parse(dec.decode(plain));
  }catch(e){
    console.error('decrypt failed', e);
    throw new Error('รหัสไม่ถูกต้องหรือข้อมูลเสียหาย');
  }
}

// create anonymous gist (no auth) - returns gist id
async function createAnonymousGist(filename='breaker_sync_encrypted.json', contentStr='{}', description='Anonymous encrypted breaker sync'){
  const body = {
    public: false,
    files: {}
  };
  body.files[filename] = { content: contentStr };
  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error('สร้าง Gist ไม่สำเร็จ: ' + res.status);
  const j = await res.json();
  return j.id;
}

// update anonymous gist content (no auth) - PATCH by gist id; but PATCH requires authentication.
// For anonymous gist created without auth, updating requires using the same session (not possible).
// So for anonymous gist updates, we overwrite by creating a new gist and informing user to replace id.
// We'll implement: saveEncryptedGist will create new gist and return new id.
async function saveEncryptedToGist(encryptedObj, filename){
  // If a central GIST token is configured, try to update existing gistId via PATCH.
  const central = (window.__CENTRAL_GIST||{});
  const centralToken = central.token || '';
  const centralGistId = central.gistId || '';

  const contentStr = JSON.stringify(encryptedObj, null, 2);
  const fname = filename || ('breaker_sync_encrypted.json');
  // if central token available and gistId provided, attempt to PATCH (update) that gist
  if(centralToken && centralGistId){
    const url = 'https://api.github.com/gists/' + centralGistId;
    const body = { files: {} };
    body.files[fname] = { content: contentStr };
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type':'application/json', 'Authorization': 'token ' + centralToken },
      body: JSON.stringify(body)
    });
    if(!res.ok) throw new Error('ไม่สามารถอัปเดต Gist กลาง: ' + res.status);
    const j = await res.json();
    // record to history
    recordGistHistory(j.id);
    return j.id;
  }
  // create new anonymous gist with content
  const newId = await createAnonymousGist(fname, contentStr, 'Encrypted breaker sync - anonymous');
  // record to history
  recordGistHistory(newId);
  return newId;
}


// load gist content by id (public or private) - uses unauthenticated GET
async function loadGistContent(gistId){
  const res = await fetch('https://api.github.com/gists/' + gistId);
  if(!res.ok) throw new Error('ไม่พบ Gist หรือไม่สามารถดึงข้อมูล: ' + res.status);
  const j = await res.json();
  // take first file
  const files = j.files || {};
  const firstKey = Object.keys(files)[0];
  if(!firstKey) throw new Error('Gist ไม่มีไฟล์');
  const content = files[firstKey].content;
  return content;
}

// UI hooks for PIN and gist operations
document.addEventListener('DOMContentLoaded', ()=>{
  const pinInput = document.getElementById('pinInput');
  const setPinBtn = document.getElementById('setPinBtn');
  const clearPinBtn = document.getElementById('clearPinBtn');
  const pinInfo = document.getElementById('pinInfo');
  const createAnonBtn = document.getElementById('createAnonGist');
  const anonGistIdInput = document.getElementById('anonGistId');
  const saveEncryptedBtn = document.getElementById('saveEncryptedGist');
  const loadEncryptedBtn = document.getElementById('loadEncryptedGist');

  // load stored pin indicator (we store only hash - using simple SHA-256 of PIN for match)
  function hashPin(p){
    const enc = new TextEncoder();
    return crypto.subtle.digest('SHA-256', enc.encode(p)).then(d=>{ return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join(''); });
  }

  setPinBtn.addEventListener('click', async ()=>{
    const p = pinInput.value.trim();
    if(!p) return alert('กรุณากรอก PIN/Password');
    const h = await hashPin(p);
    const s = loadSettings()||{};
    s.pinHash = h;
    saveSettings(s);
    pinInfo.textContent = 'ตั้งค่า PIN เรียบร้อย (ถูกเก็บเป็นแฮช)';
    pinInput.value='';
  });

  clearPinBtn.addEventListener('click', ()=>{
    const s = loadSettings()||{};
    delete s.pinHash; saveSettings(s);
    pinInfo.textContent = 'ลบ PIN ในเครื่องแล้ว';
  });

  createAnonBtn.addEventListener('click', async ()=>{
    try{
      createAnonBtn.disabled = true; createAnonBtn.textContent = 'กำลังสร้าง...';
      const id = await createAnonymousGist();
      anonGistIdInput.value = id;
      alert('สร้าง Gist เปล่าเรียบร้อย\nGist ID: ' + id + '\nโปรดเก็บ ID นี้ไว้เพื่อโหลด/อัปเดต');
    }catch(e){ alert('สร้าง Gist ไม่สำเร็จ: ' + e.message); console.error(e); }
    finally{ createAnonBtn.disabled=false; createAnonBtn.textContent='สร้าง Gist เปล่า (Anonymous)'; }
  });

  saveEncryptedBtn.addEventListener('click', async ()=>{
    try{
      const gid = anonGistIdInput.value.trim();
      if(!gid){
        if(!confirm('ยังไม่มี Gist ID ในช่อง ระบบจะสร้าง Gist ใหม่แบบ anonymous และคืน ID ให้ คุณต้องการดำเนินการหรือไม่?')) return;
      }
      const p = prompt('กรอก PIN/Password ที่ตั้งไว้เพื่อเข้ารหัสและบันทึก (ใส่ใหม่หากไม่ได้ตั้ง)');
      if(!p) return alert('ต้องใส่ PIN');
      // verify pin if stored
      const s = loadSettings()||{};
      if(s.pinHash){
        const h = await hashPin(p);
        if(h !== s.pinHash) return alert('PIN ไม่ตรงกับที่ตั้งไว้');
      }
      // build payload (settings + logs)
      const payload = getAllDataForSync();
      const encObj = await encryptJSON(payload, p);
      const newId = await saveEncryptedToGist(encObj);
      anonGistIdInput.value = newId;
      alert('บันทึกเรียบร้อย (encrypted) - Gist ID ใหม่: ' + newId + '\nโปรดเก็บ ID นี้ไว้');
    }catch(e){ alert('บันทึกล้มเหลว: ' + e.message); console.error(e); }
  });

  loadEncryptedBtn.addEventListener('click', async ()=>{
    try{
      const gid = anonGistIdInput.value.trim();
      if(!gid) return alert('กรุณาใส่ Gist ID');
      const content = await loadGistContent(gid);
      const encObj = JSON.parse(content);
      const p = prompt('กรอก PIN/Password เพื่อถอดรหัสข้อมูล');
      if(!p) return;
      const obj = await decryptJSON(encObj, p);
      // apply data
      applyAllDataFromSync(obj);
      alert('โหลดข้อมูลและถอดรหัสเรียบร้อย');
    }catch(e){ alert('โหลด/ถอดรหัสล้มเหลว: ' + e.message); console.error(e); }
  });

  // if settings contain anon gist id, populate input
  const s = loadSettings()||{};
  if(s.anonGistId) anonGistIdInput.value = s.anonGistId;
  if(s.pinHash) pinInfo.textContent = 'PIN ตั้งไว้แล้ว (เก็บเป็นแฮช)';
});
/* ---------- End encryption & anonymous gist ---------- */




// Record gist id into history (keeps last 20)
function recordGistHistory(gistId){
  try{
    if(!gistId) return;
    const key = 'anon_gist_history_v1';
    const raw = localStorage.getItem(key) || '[]';
    const arr = JSON.parse(raw);
    // remove if exists
    const idx = arr.indexOf(gistId);
    if(idx !== -1) arr.splice(idx,1);
    arr.unshift(gistId);
    // keep last 20
    while(arr.length>20) arr.pop();
    localStorage.setItem(key, JSON.stringify(arr));
    renderGistHistory();
  }catch(e){ console.error('recordGistHistory err', e); }
}

function getGistHistory(){
  try{ return JSON.parse(localStorage.getItem('anon_gist_history_v1')||'[]'); }catch(e){ return []; }
}

function renderGistHistory(){
  const ulId = 'gistHistoryList';
  let container = document.getElementById(ulId);
  if(!container){
    // create container below anonGistId input if present
    const inp = document.getElementById('anonGistId');
    if(inp){
      container = document.createElement('div');
      container.id = ulId;
      container.style.marginTop = '8px';
      container.style.fontSize = '13px';
      inp.parentNode.insertBefore(container, inp.nextSibling);
    } else return;
  }
  const list = getGistHistory();
  if(list.length===0){ container.innerHTML = '<div style=\"color:#666\">ยังไม่มีประวัติ Gist</div>'; return; }
  container.innerHTML = '<strong>Gist history (latest first)</strong><ul style=\"padding-left:18px\">' + list.map(id => `<li style="margin:6px 0"><code>${id}</code> <button data-id="${id}" class="btn ghost small loadHistoryBtn">Load</button> <button data-id="${id}" class="btn ghost small copyHistoryBtn">Copy</button></li>`).join('') + '</ul>';
  // attach handlers
  container.querySelectorAll('.loadHistoryBtn').forEach(b=>{
    b.addEventListener('click', ()=>{ document.getElementById('anonGistId').value = b.getAttribute('data-id'); });
  });
  container.querySelectorAll('.copyHistoryBtn').forEach(b=>{
    b.addEventListener('click', ()=>{ navigator.clipboard.writeText(b.getAttribute('data-id')); alert('Copied'); });
  });
}

// render on load
document.addEventListener('DOMContentLoaded', ()=>{ renderGistHistory(); });




// ---------- Recovery Code (shareable, time-limited) ----------
// Generates a recovery code (base64) that encapsulates encrypted symmetric material with expiry.
// The code can be pasted into 'Use Recovery Code' to restore PIN hash into localStorage.

function bufToB64(u8){ return btoa(String.fromCharCode.apply(null, new Uint8Array(u8))); }
function b64ToBuf(s){ const bin = atob(s); const arr = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i); return arr; }

async function generateRecoveryCode(ttlMinutes=60){
  // payload: {pinHash, createdAt, expiresAt}
  const s = loadSettings()||{};
  if(!s.pinHash) throw new Error('ยังไม่ได้ตั้ง PIN');
  const payload = { pinHash: s.pinHash, createdAt: Date.now(), expiresAt: Date.now() + (ttlMinutes*60*1000) };
  const json = JSON.stringify(payload);
  // derive a random key to encrypt payload, then output key+cipher as base64 so recipient can decrypt
  const keyRaw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', keyRaw, {name:'AES-GCM'}, false, ['encrypt']);
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, cryptoKey, enc.encode(json));
  // assemble code: base64(keyRaw|iv|cipher)
  const combined = new Uint8Array(keyRaw.byteLength + iv.byteLength + cipher.byteLength);
  combined.set(keyRaw,0); combined.set(iv, keyRaw.byteLength); combined.set(new Uint8Array(cipher), keyRaw.byteLength + iv.byteLength);
  return bufToB64(combined);
}

async function useRecoveryCode(code){
  // code is base64 of keyRaw+iv+cipher
  const arr = b64ToBuf(code);
  const keyRaw = arr.slice(0,32);
  const iv = arr.slice(32,44);
  const cipher = arr.slice(44);
  const cryptoKey = await crypto.subtle.importKey('raw', keyRaw, {name:'AES-GCM'}, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv}, cryptoKey, cipher);
  const dec = new TextDecoder();
  const payload = JSON.parse(dec.decode(plain));
  if(Date.now() > payload.expiresAt) throw new Error('Recovery code หมดอายุแล้ว');
  // restore pinHash to settings
  const s = loadSettings()||{};
  s.pinHash = payload.pinHash;
  saveSettings(s);
  return true;
}

// wire UI
document.addEventListener('DOMContentLoaded', ()=>{
  const genBtn = document.getElementById('genRecoveryCode');
  const out = document.getElementById('recoveryCodeOutput');
  const useBtn = document.getElementById('useRecoveryCodeBtn');
  if(genBtn){
    genBtn.addEventListener('click', async ()=>{
      try{
        const code = await generateRecoveryCode(60); // 60 minutes by default
        out.value = code;
        alert('สร้าง Recovery Code แล้ว (เก็บ/แชร์อย่างระมัดระวัง)');
      }catch(e){ alert('ไม่สามารถสร้าง Recovery Code: ' + e.message); console.error(e); }
    });
  }
  if(useBtn){
    useBtn.addEventListener('click', async ()=>{
      try{
        const code = out.value.trim();
        if(!code) return alert('วาง Recovery Code ในช่องก่อน');
        await useRecoveryCode(code);
        alert('กู้ PIN สำเร็จ');
      }catch(e){ alert('ไม่สามารถใช้ Recovery Code: ' + e.message); console.error(e); }
    });
  }
});
