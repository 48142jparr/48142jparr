async function fetchCallActivity() {
  const summaryDiv = document.getElementById('summary');
  const dataSection = document.getElementById('data-section');
  summaryDiv.textContent = 'Loading...';
  dataSection.innerHTML = '';
  try {
    const resp = await fetch('/call-activity-exists');
    if (!resp.ok) throw new Error('Failed to fetch data');
    const data = await resp.json();
    if (!data.exists) {
      summaryDiv.textContent = 'No call activity data found for the last year.';
      return;
    }
    summaryDiv.innerHTML = `<b>Data exists:</b> <span style='color:green'>Yes</span> | <b>Count:</b> ${data.count}`;
    if (data.data) {
      let table = '<table><thead><tr>';
      data.fields.forEach(f => { table += `<th>${f}</th>`; });
      table += '</tr></thead><tbody><tr>';
      data.fields.forEach(f => {
        let val = data.data[f];
        if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
        table += `<td>${val ?? ''}</td>`;
      });
      table += '</tr></tbody></table>';
      dataSection.innerHTML = table;
    }
  } catch (err) {
    summaryDiv.textContent = 'Error loading data.';
    dataSection.innerHTML = `<div style='color:red'>${err.message}</div>`;
  }
}

async function fetchNumbers() {
  const resp = await fetch('/fetch-all-phone-numbers');
  if (!resp.ok) throw new Error('Fetch failed: ' + resp.status);
  return resp.json();
}

function formatNumber(n){
  // basic NANP formatting if starts with +1
  if (!n) return '';
  if (n.startsWith('+1') && n.length === 12) {
    return `(${n.slice(2,5)}) ${n.slice(5,8)}-${n.slice(8)}`;
  }
  return n;
}

function createCard(item){
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `
    <div class="number">${formatNumber(item.number)}</div>
    <div class="name">${item.name || ''}</div>
    <div class="meta">
      <div class="tag ${item.status==='DEACTIVATED' ? 'status-deactivated':'status-active'}">${item.status}</div>
      <div class="actions">
        <button class="action-btn" data-number="${item.number}">Copy</button>
        <button class="action-btn" data-number="${item.number}">Call</button>
      </div>
    </div>
  `;
  return div;
}

function initUI(){
  const refreshBtn = document.getElementById('refresh-btn');
  const dataSection = document.getElementById('data-section');
  const summary = document.getElementById('summary');

  refreshBtn.addEventListener('click', async ()=>{
    refreshBtn.disabled = true; refreshBtn.textContent='Loading...';
    try {
      const json = await fetchNumbers();
      dataSection.innerHTML = '';
      if (!json.phoneNumbers || json.phoneNumbers.length===0){
        dataSection.innerHTML = '<div class="empty">No phone numbers found.</div>';
      } else {
        json.phoneNumbers.forEach(p => dataSection.appendChild(createCard(p)));
      }
      summary.textContent = `Account: ${json.accountKey} — Numbers: ${json.phoneNumbers.length}`;
    } catch (err) {
      dataSection.innerHTML = `<div class="empty">Error: ${err.message}</div>`;
    } finally {
      refreshBtn.disabled = false; refreshBtn.textContent='Refresh';
    }
  });

  // delegate copy/call actions
  document.addEventListener('click', e=>{
    if (e.target.matches('.action-btn')){
      const num = e.target.getAttribute('data-number');
      if (e.target.textContent.trim()==='Copy') navigator.clipboard.writeText(num).then(()=>{e.target.textContent='Copied'; setTimeout(()=>e.target.textContent='Copy',1200)});
      if (e.target.textContent.trim()==='Call') window.open('tel:'+num);
    }
  });

  // auto-load
  refreshBtn.click();
}

document.getElementById('refresh-btn').addEventListener('click', fetchCallActivity);
window.onload = fetchCallActivity;
window.addEventListener('DOMContentLoaded', initUI);
