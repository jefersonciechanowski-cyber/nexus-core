window.NEXUS_SUPABASE_CONFIG = {
  url: 'https://svphwbccqeoakpmcpvhy.supabase.co',
  publishableKey: 'sb_publishable_69PVF-UYPFZMouwTUnj4qQ_n0VPzLzL'
};

window.NEXUS_SUPPORT_EMAIL = 'suporte@nexuscore.app.br';

(function nexusProductionUi(){
  const supportEmail=window.NEXUS_SUPPORT_EMAIL;
  const supportHref=`mailto:${supportEmail}`;
  const adminLinkStyle='display:block;border:1px solid transparent;background:transparent;color:#98a2a7;text-align:left;padding:12px 14px;border-radius:9px;text-decoration:none;font:inherit';

  function addSupport(){
    const path=location.pathname;
    if(!path.includes('/apps/'))return;

    const footerLinks=document.querySelector('.footer-links');
    if(footerLinks&&!footerLinks.querySelector('[data-nexus-support]')){
      const link=document.createElement('a');
      link.href=supportHref;
      link.textContent='Suporte';
      link.dataset.nexusSupport='true';
      footerLinks.appendChild(link);
      return;
    }

    if(document.querySelector('[data-nexus-support]'))return;
    const wrap=document.createElement('div');
    wrap.dataset.nexusSupport='true';
    wrap.style.cssText='margin:18px auto 8px;max-width:1100px;padding:0 18px;text-align:center;color:#8f9aa0;font:12px/1.5 Inter,Segoe UI,Arial,sans-serif';
    wrap.innerHTML=`Precisa de ajuda? <a href="${supportHref}" style="color:#d9a62d;text-decoration:none">${supportEmail}</a>`;
    document.body.appendChild(wrap);
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

  function init(){addSupport();addAdminLeadsLink();addAdminAccountsLink();enhanceCrmCommercial();enhanceMultiCompanyUi();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
