window.NEXUS_SUPABASE_CONFIG = {
  url: 'https://svphwbccqeoakpmcpvhy.supabase.co',
  publishableKey: 'sb_publishable_69PVF-UYPFZMouwTUnj4qQ_n0VPzLzL'
};

window.NEXUS_SUPPORT_EMAIL = 'suporte@nexuscore.app.br';

(function nexusProductionUi(){
  const adminLinkStyle='display:block;border:1px solid transparent;background:transparent;color:#98a2a7;text-align:left;padding:12px 14px;border-radius:9px;text-decoration:none;font:inherit';

  function addSupport(){
    const path=location.pathname;
    if(!path.includes('/apps/'))return;

    document.querySelectorAll('[data-nexus-support]').forEach(element=>element.remove());
    document.querySelectorAll('a[href^="mailto:suporte@"]').forEach(element=>element.remove());

    if(document.querySelector('script[data-nexus-support-loader]'))return;
    const script=document.createElement('script');
    script.src='/apps/sst-controle/nexus-support.js';
    script.async=true;
    script.dataset.nexusSupportLoader='true';
    document.head.appendChild(script);
  }

  function decorateAdminLink(link){
    link.style.cssText=adminLinkStyle;
    link.addEventListener('mouseenter',()=>{link.style.color='#fff';link.style.background='rgba(255,255,255,.025)'});
    link.addEventListener('mouseleave',()=>{link.style.color='#98a2a7';link.style.background='transparent'});
  }

  function addAdminLeadsLink(){
    if(!location.pathname.includes('/apps/nexus-admin/'))return;
    const nav=document.querySelector('.nav');
    if(!nav||nav.querySelector('[data-nexus-leads-link],a[href="leads.html"]'))return;
    const link=document.createElement('a');
    link.href='leads.html';
    link.textContent='CRM Comercial';
    link.dataset.nexusLeadsLink='true';
    decorateAdminLink(link);
    const payments=nav.querySelector('[data-view="payments"]');
    if(payments&&payments.nextSibling)nav.insertBefore(link,payments.nextSibling);else nav.appendChild(link);
  }

  function addAdminAccountsLink(){
    if(!location.pathname.includes('/apps/nexus-admin/'))return;
    const nav=document.querySelector('.nav');
    if(!nav||nav.querySelector('[data-nexus-accounts-link],a[href="accounts.html"]'))return;
    const link=document.createElement('a');
    link.href='accounts.html';
    link.textContent='Contas e Consultorias';
    link.dataset.nexusAccountsLink='true';
    decorateAdminLink(link);
    const crm=nav.querySelector('[data-nexus-leads-link],a[href="leads.html"]');
    if(crm&&crm.nextSibling)nav.insertBefore(link,crm.nextSibling);else nav.appendChild(link);
  }

  function normalizeAdminNavigation(){
    if(!location.pathname.includes('/apps/nexus-admin/'))return;
    const nav=document.querySelector('.nav');
    if(!nav)return;

    const classify=node=>{
      const view=node.dataset?.view;
      if(view==='overview')return 'overview';
      if(view==='clients')return 'clients';
      if(view==='products')return 'products';
      if(view==='payments')return 'payments';
      const href=String(node.getAttribute?.('href')||'').toLowerCase();
      const text=String(node.textContent||'').trim().toLowerCase();
      if(href.includes('leads')||text==='crm comercial')return 'crm';
      if(href.includes('accounts')||text==='contas e consultorias')return 'accounts';
      if(href==='index.html'&&text.includes('visão geral'))return 'overview';
      if(text.includes('clientes e acessos'))return 'clients';
      if(text.includes('produtos e planos'))return 'products';
      if(text==='pagamentos')return 'payments';
      return null;
    };

    const nodes=[...nav.children];
    const byKey=new Map();
    nodes.forEach(node=>{
      const key=classify(node);
      if(key&&!byKey.has(key))byKey.set(key,node);
    });

    ['overview','crm','accounts','clients','products','payments'].forEach(key=>{
      const node=byKey.get(key);
      if(node)nav.appendChild(node);
    });

    let central=nav.querySelector('[data-nexus-admin-central-link]');
    if(!central){
      central=document.createElement('a');
      central.href='../portal-cliente/';
      central.textContent='Minha Central';
      central.dataset.nexusAdminCentralLink='true';
      central.title='Voltar para Minha Central Nexus';
      central.style.cssText='display:block;margin-top:12px;padding:16px 14px 12px;border:0;border-top:1px solid rgba(224,184,74,.18);background:transparent;color:#e0b84a;text-align:left;text-decoration:none;font:600 12px/1.2 Inter,Segoe UI,Arial,sans-serif';
      central.addEventListener('mouseenter',()=>{central.style.color='#fff';central.style.background='rgba(224,184,74,.06)'});
      central.addEventListener('mouseleave',()=>{central.style.color='#e0b84a';central.style.background='transparent'});
    }
    nav.appendChild(central);
  }

  function addSstCentralLink(){
    if(!location.pathname.includes('/apps/sst-controle/'))return;
    if(document.querySelector('[data-nexus-central-link]'))return;

    const logout=[...document.querySelectorAll('button,a')]
      .find(element=>String(element.textContent||'').trim().toLowerCase()==='sair');
    if(!logout||!logout.parentElement)return;

    const link=document.createElement('a');
    link.href='../portal-cliente/';
    link.textContent='Minha Central';
    link.dataset.nexusCentralLink='true';
    link.title='Voltar para Minha Central Nexus';
    link.style.cssText='display:inline-flex;align-items:center;justify-content:center;margin-top:7px;margin-right:7px;padding:6px 10px;border:1px solid #2f393f;border-radius:7px;background:#0d171c;color:#e0b84a;text-decoration:none;font:600 11px/1.2 Inter,Segoe UI,Arial,sans-serif;white-space:nowrap';
    link.addEventListener('mouseenter',()=>{link.style.borderColor='#e0b84a';link.style.background='#111a1f'});
    link.addEventListener('mouseleave',()=>{link.style.borderColor='#2f393f';link.style.background='#0d171c'});
    logout.parentElement.insertBefore(link,logout);
  }

  async function addPortalAdminShortcuts(){
    if(!location.pathname.includes('/apps/portal-cliente/'))return;
    if(document.querySelector('[data-nexus-admin-shortcuts]'))return;

    let session=null;
    try{
      const raw=sessionStorage.getItem('nexus_demo_session');
      if(raw)session=JSON.parse(raw);
    }catch{}

    if(!session?.role&&window.NexusAuth?.restoreSession){
      try{session=await window.NexusAuth.restoreSession();}catch{}
    }
    if(session?.role!=='nexus_admin')return;

    const main=document.querySelector('.main');
    const welcome=document.querySelector('.welcome');
    if(!main||!welcome)return;

    if(!document.querySelector('style[data-nexus-admin-shortcuts-style]')){
      const style=document.createElement('style');
      style.dataset.nexusAdminShortcutsStyle='true';
      style.textContent=`
        .nexus-admin-shortcuts{margin:0 0 22px;padding:16px 18px;border:1px solid rgba(224,184,74,.28);border-radius:12px;background:linear-gradient(135deg,rgba(224,184,74,.08),rgba(17,26,31,.96))}
        .nexus-admin-shortcuts-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.nexus-admin-shortcuts-head strong{font-size:13px}.nexus-admin-shortcuts-head span{color:#98a2a7;font-size:11px}
        .nexus-admin-shortcuts-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.nexus-admin-shortcut{display:flex;align-items:center;justify-content:center;min-height:42px;padding:10px 12px;border:1px solid #2f393f;border-radius:8px;background:#0d171c;color:#f5eee0;text-decoration:none;font:700 11px/1.25 Inter,Segoe UI,Arial,sans-serif;text-align:center}.nexus-admin-shortcut:hover{border-color:#e0b84a;color:#e0b84a;background:#111a1f}
        @media(max-width:820px){.nexus-admin-shortcuts-grid{grid-template-columns:1fr 1fr}.nexus-admin-shortcuts-head{align-items:flex-start;flex-direction:column}}
      `;
      document.head.appendChild(style);
    }

    const section=document.createElement('section');
    section.className='nexus-admin-shortcuts';
    section.dataset.nexusAdminShortcuts='true';
    section.innerHTML=`<div class="nexus-admin-shortcuts-head"><strong>Atalhos do administrador</strong><span>Navegação interna Nexus</span></div><div class="nexus-admin-shortcuts-grid"><a class="nexus-admin-shortcut" href="../nexus-admin/">Central Nexus Administração</a><a class="nexus-admin-shortcut" href="../nexus-admin/leads.html">CRM Comercial</a><a class="nexus-admin-shortcut" href="../nexus-admin/accounts.html">Contas e Consultorias</a><a class="nexus-admin-shortcut" href="../site-captacao/">Site Comercial</a></div>`;
    welcome.insertAdjacentElement('afterend',section);
  }

  function enhanceCrmCommercial(){
    if(!location.pathname.includes('/apps/nexus-admin/leads'))return;

    const style=document.createElement('style');
    style.dataset.nexusCrmEnhancement='true';
    style.textContent=`
      .column{
        height:clamp(430px,62vh,650px)!important;
        display:grid!important;
        grid-template-rows:auto minmax(0,1fr)!important;
        overflow:hidden!important;
      }
      .column-body{
        overflow-y:auto!important;
        min-height:0!important;
        scrollbar-gutter:stable;
      }
      .column-body::-webkit-scrollbar{width:9px}
      .column-body::-webkit-scrollbar-track{background:#0a1216}
      .column-body::-webkit-scrollbar-thumb{background:#344249;border-radius:99px;border:2px solid #0a1216}
      .column-body::-webkit-scrollbar-thumb:hover{background:#526169}

      body.nexus-crm-detail-open{overflow:hidden}
      body.nexus-crm-detail-open::before{
        content:'';
        position:fixed;
        inset:0;
        z-index:99;
        background:rgba(0,0,0,.68);
        backdrop-filter:blur(1px);
      }
      #detail:not([hidden]){
        position:fixed!important;
        top:50%!important;
        left:50%!important;
        transform:translate(-50%,-50%)!important;
        z-index:100!important;
        width:min(1000px,calc(100vw - 40px))!important;
        max-height:90vh!important;
        overflow:auto!important;
        margin:0!important;
        padding:20px!important;
        background:#111a1f!important;
        border:1px solid #2f393f!important;
        border-radius:12px!important;
        box-shadow:0 24px 80px rgba(0,0,0,.55)!important;
      }
      .nexus-crm-floating-close{
        position:sticky;
        top:0;
        z-index:3;
        display:block;
        margin:0 0 10px auto;
        padding:8px 12px;
        border:1px solid #2f393f;
        border-radius:7px;
        background:#0d171c;
        color:#f5eee0;
        cursor:pointer;
      }
      .nexus-crm-floating-close:hover{border-color:#e0b84a}

      @media(max-width:820px){
        .column{height:58vh!important;min-height:390px!important}
        #detail:not([hidden]){
          width:calc(100vw - 24px)!important;
          max-height:92vh!important;
          padding:16px!important;
        }
      }
    `;
    document.head.appendChild(style);

    const detail=document.getElementById('detail');
    if(!detail)return;

    const syncDetailState=()=>{
      const isOpen=!detail.hidden;
      document.body.classList.toggle('nexus-crm-detail-open',isOpen);

      if(isOpen&&!detail.querySelector('[data-nexus-crm-floating-close]')){
        const close=document.createElement('button');
        close.type='button';
        close.className='nexus-crm-floating-close';
        close.dataset.nexusCrmFloatingClose='true';
        close.textContent='Fechar';
        close.addEventListener('click',()=>{
          const nativeClose=detail.querySelector('#closeDetail');
          if(nativeClose)nativeClose.click();
          else detail.hidden=true;
        });
        detail.prepend(close);
      }
    };

    const observer=new MutationObserver(syncDetailState);
    observer.observe(detail,{attributes:true,attributeFilter:['hidden'],childList:true});
    syncDetailState();

    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||detail.hidden)return;
      const nativeClose=detail.querySelector('#closeDetail');
      if(nativeClose)nativeClose.click();
      else detail.hidden=true;
    });
  }

  function enhanceMultiCompanyUi(){
    const globalCompany=document.getElementById('globalCompany');
    if(globalCompany){
      globalCompany.style.colorScheme='dark';
      if(!document.querySelector('style[data-nexus-company-select]')){
        const style=document.createElement('style');
        style.dataset.nexusCompanySelect='true';
        style.textContent=`
          #globalCompany{
            color-scheme:dark!important;
            background:#111a1f!important;
            color:#f5eee0!important;
          }
          #globalCompany option{
            background:#111a1f!important;
            color:#f5eee0!important;
          }
          #globalCompany option:checked{
            background:#1f5fbf!important;
            color:#ffffff!important;
          }
          #nexusCompanyDocument:disabled{
            opacity:.55;
            cursor:not-allowed;
          }
        `;
        document.head.appendChild(style);
      }
    }

    const bindDocumentFields=()=>{
      const type=document.getElementById('nexusCompanyDocumentType');
      const number=document.getElementById('nexusCompanyDocument');
      if(!type||!number)return false;
      if(type.dataset.nexusDocumentBound)return true;

      const sync=()=>{
        const enabled=type.value==='CNPJ'||type.value==='CPF';
        number.disabled=!enabled;
        number.required=enabled;
        number.placeholder=enabled
          ? (type.value==='CNPJ'?'14 caracteres':'11 dígitos')
          : 'Selecione CPF ou CNPJ';
        if(!enabled)number.value='';
      };

      type.dataset.nexusDocumentBound='true';
      type.addEventListener('change',sync);
      sync();
      return true;
    };

    if(!bindDocumentFields()){
      const observer=new MutationObserver(()=>{
        if(bindDocumentFields())observer.disconnect();
      });
      observer.observe(document.body,{childList:true,subtree:true});
    }
  }

  function loadEmployeeImportModule(){
    if(!location.pathname.includes('/apps/sst-controle/'))return;
    if(document.querySelector('script[data-nexus-employee-import-loader]'))return;
    const script=document.createElement('script');
    script.src='supabase-employee-import.js';
    script.async=true;
    script.dataset.nexusEmployeeImportLoader='true';
    document.head.appendChild(script);
  }

  function loadCollectionImportModule(){
    if(!location.pathname.includes('/apps/sst-controle/'))return;
    if(document.querySelector('script[data-nexus-collection-import-loader]'))return;
    const script=document.createElement('script');
    script.src='supabase-collection-import.js';
    script.async=true;
    script.dataset.nexusCollectionImportLoader='true';
    document.head.appendChild(script);
  }

  function init(){addSupport();addAdminLeadsLink();addAdminAccountsLink();normalizeAdminNavigation();addSstCentralLink();addPortalAdminShortcuts();enhanceCrmCommercial();enhanceMultiCompanyUi();loadEmployeeImportModule();loadCollectionImportModule();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();