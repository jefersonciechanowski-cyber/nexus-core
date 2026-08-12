window.NEXUS_SUPABASE_CONFIG = {
  url: 'https://svphwbccqeoakpmcpvhy.supabase.co',
  publishableKey: 'sb_publishable_69PVF-UYPFZMouwTUnj4qQ_n0VPzLzL'
};

window.NEXUS_SUPPORT_EMAIL = 'suporte@nexuscore.app.br';

(function nexusProductionUi(){
  const supportEmail=window.NEXUS_SUPPORT_EMAIL;
  const supportHref=`mailto:${supportEmail}`;

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

  function addAdminLeadsLink(){
    if(!location.pathname.includes('/apps/nexus-admin/'))return;
    const nav=document.querySelector('.nav');
    if(!nav||nav.querySelector('[data-nexus-leads-link]'))return;
    const link=document.createElement('a');
    link.href='leads.html';
    link.textContent='CRM Comercial';
    link.dataset.nexusLeadsLink='true';
    link.style.cssText='display:block;border:1px solid transparent;background:transparent;color:#98a2a7;text-align:left;padding:12px 14px;border-radius:9px;text-decoration:none;font:inherit';
    link.addEventListener('mouseenter',()=>{link.style.color='#fff';link.style.background='rgba(255,255,255,.025)'});
    link.addEventListener('mouseleave',()=>{link.style.color='#98a2a7';link.style.background='transparent'});
    const payments=nav.querySelector('[data-view="payments"]');
    if(payments&&payments.nextSibling)nav.insertBefore(link,payments.nextSibling);else nav.appendChild(link);
  }

  function init(){addSupport();addAdminLeadsLink();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
