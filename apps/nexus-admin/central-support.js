(function centralSupportHub() {
  'use strict';
  if (typeof pageConfig !== 'undefined') {
    pageConfig.support = ['Suporte','Chamados do CRM, SST e demais plataformas em uma única fila.'];
  }
  const panel = document.getElementById('view-support');
  if (!panel) return;
  const list = panel.querySelector('#supportTicketList');
  const detail = panel.querySelector('#supportTicketDetail');
  const notice = panel.querySelector('#supportTicketNotice');
  const filterStatus = panel.querySelector('#supportStatusFilter');
  const filterProduct = panel.querySelector('#supportProductFilter');
  const search = panel.querySelector('#supportSearch');
  const refresh = panel.querySelector('#supportRefresh');
  const counters = {
    open: panel.querySelector('#supportCountOpen'),
    in_progress: panel.querySelector('#supportCountProgress'),
    resolved: panel.querySelector('#supportCountResolved'),
    closed: panel.querySelector('#supportCountClosed')
  };
  const statuses = {open:'Aberto',in_progress:'Em atendimento',resolved:'Resolvido',closed:'Encerrado'};
  const products = {nexus_crm:'Nexus CRM',crm:'Nexus CRM',sst:'SST Controle',central_nexus:'Nexus Central',estetica:'Nexus Estética'};
  let tickets = [];
  let selectedId = '';
  let loading = false;
  let saving = false;

  function labelProduct(code) {return products[code] || code || 'Nexus';}
  function el(tag,className,textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = String(textContent);
    return node;
  }
  function dateLabel(date) {
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'});
  }
  function notify(message, isError=false) {
    notice.textContent = message;
    notice.classList.toggle('bad',isError);
  }
  async function authorizedClient() {
    if (!window.NexusAuth?.getClient) throw new Error('Entre na Central Nexus para consultar os chamados.');
    const client = window.NexusAuth.getClient();
    const {data:userData,error:userError} = await client.auth.getUser();
    if (userError || !userData?.user) throw new Error('Sua sessão precisa ser renovada.');
    const {data:aal,error:aalError} = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError || aal?.currentLevel !== 'aal2') throw new Error('Confirme a autenticação em duas etapas para acessar o suporte.');
    return client;
  }
  function row(field,value) {
    const box=el('div','support-info-item');
    box.append(el('span','',field),el('strong','',value || '—'));
    return box;
  }
  function filteredTickets() {
    const term=search.value.trim().toLocaleLowerCase('pt-BR');
    return tickets.filter(ticket => {
      if (filterStatus.value !== 'all' && ticket.status !== filterStatus.value) return false;
      if (filterProduct.value !== 'all' && ticket.product_code !== filterProduct.value) return false;
      return !term || [ticket.protocol,ticket.requester_name,ticket.requester_email,ticket.source,ticket.product_code,ticket.message]
        .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(term));
    });
  }
  function renderList() {
    list.replaceChildren();
    for (const [status,node] of Object.entries(counters)) node.textContent=String(tickets.filter(ticket => ticket.status === status).length);
    const visible=filteredTickets();
    panel.querySelector('#supportTicketTotal').textContent=`${visible.length} de ${tickets.length} chamados recentes`;
    if (!visible.length) {list.append(el('p','support-empty','Nenhum chamado encontrado.'));return;}
    const fragment=document.createDocumentFragment();
    visible.forEach(ticket => {
      const button=el('button','support-ticket-item' + (ticket.id===selectedId?' selected':''));
      button.type='button';
      button.setAttribute('aria-pressed',String(ticket.id===selectedId));
      const top=el('div','support-ticket-top');
      top.append(el('strong','',ticket.protocol),el('span','support-status support-status-'+ticket.status,statuses[ticket.status]||ticket.status));
      button.append(top,el('div','support-ticket-name',ticket.requester_name || 'Solicitante'),
        el('div','support-ticket-meta',labelProduct(ticket.product_code)+' · '+dateLabel(ticket.created_at)),
        el('p','support-ticket-preview',ticket.message || ''));
      button.addEventListener('click',() => {selectedId=ticket.id;renderList();renderDetail();});
      fragment.append(button);
    });
    list.append(fragment);
  }
  function safePageLink(value) {
    try {
      const url=new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      return url.toString();
    } catch {return null;}
  }
  function renderDetail() {
    detail.replaceChildren();
    const ticket=tickets.find(item => item.id===selectedId);
    if (!ticket) {detail.append(el('p','support-empty','Selecione um chamado para consultar os detalhes.'));return;}
    const head=el('div','support-detail-head');
    const heading=el('div');
    heading.append(el('span','support-overline','Protocolo'),el('h3','',ticket.protocol));
    head.append(heading,el('span','support-status support-status-'+ticket.status,statuses[ticket.status]||ticket.status));
    detail.append(head);
    const info=el('div','support-info-grid');
    info.append(row('Solicitante',ticket.requester_name),row('E-mail',ticket.requester_email),
      row('Produto',labelProduct(ticket.product_code)),row('Origem',ticket.source),
      row('Abertura',dateLabel(ticket.created_at)),row('Atualização',dateLabel(ticket.updated_at)));
    const org=typeof ticket.metadata?.organizationName==='string'?ticket.metadata.organizationName:'';
    if(org && ticket.metadata?.authenticated === true) info.append(row('Empresa',org));
    detail.append(info);
    const message=el('div','support-ticket-description');
    message.append(el('span','support-overline','Descrição do chamado'),el('p','',ticket.message || ''));
    detail.append(message);
    const url=safePageLink(ticket.page_url);
    if(url) {
      const link=el('a','support-safe-link','Página de origem');
      link.href=url;link.target='_blank';link.rel='noopener noreferrer';
      detail.append(link);
    }
    const footer=el('div','support-detail-actions');
    const select=el('select','support-status-select');
    select.setAttribute('aria-label','Situação do chamado');
    for(const [value,text] of Object.entries(statuses)) {
      const opt=el('option','',text);opt.value=value;
      select.append(opt);
    }
    select.value=ticket.status;
    const save=el('button','action primary','Salvar situação');
    save.type='button';
    save.disabled=saving;
    save.addEventListener('click',()=>void saveStatus(ticket,select.value,save));
    const mail=el('a','action support-mail','Responder por e-mail');
    mail.href='mailto:'+encodeURIComponent(ticket.requester_email)+'?subject='+encodeURIComponent(ticket.protocol+' - Suporte Nexus');
    const copy=el('button','action','Copiar protocolo');
    copy.type='button';
    copy.addEventListener('click',async()=> {
      try {await navigator.clipboard.writeText(ticket.protocol);notify('Protocolo copiado.');}
      catch {notify('Copie o protocolo exibido no cabeçalho.',true);}
    });
    footer.append(select,save,mail,copy);
    detail.append(footer);
    const note=el('p','support-detail-note','O atendimento via WhatsApp é iniciado pelo cliente após abrir o chamado. As conversas ainda não são sincronizadas automaticamente com esta fila.');
    detail.append(note);
  }
  async function saveStatus(ticket,next,button) {
    if (saving || next===ticket.status) return;
    if(!Object.hasOwn(statuses,next)) {notify('Situação inválida.',true);return;}
    saving=true;button.disabled=true;
    try {
      const client=await authorizedClient();
      const {data,error}=await client.from('support_requests')
        .update({status:next,updated_at:new Date().toISOString()})
        .eq('id',ticket.id).eq('status',ticket.status)
        .select('id,status,updated_at').maybeSingle();
      if(error) throw error;
      if(!data) throw new Error('O chamado foi alterado em outra sessão. Atualize a lista.');
      tickets=tickets.map(item=>item.id===ticket.id?{...item,status:data.status,updated_at:data.updated_at}:item);
      notify('Situação do chamado atualizada.');
      renderList();renderDetail();
      window.dispatchEvent(new Event('nexus:support:changed'));
    } catch(error) {
      notify(error instanceof Error ? error.message : 'Não foi possível salvar a situação.',true);
      renderDetail();
    } finally {saving=false;button.disabled=false;}
  }
  async function load() {
    if (loading) return;
    loading=true;refresh.disabled=true;
    notify('Carregando chamados...');
    try {
      const client=await authorizedClient();
      const {data,error}=await client.from('support_requests')
        .select('id,protocol,requester_name,requester_email,organization_id,source,product_code,page_url,message,status,metadata,created_at,updated_at')
        .order('created_at',{ascending:false}).limit(150);
      if(error) throw error;
      tickets=data||[];
      if(!tickets.some(item=>item.id===selectedId)) selectedId=tickets[0]?.id || '';
      renderList();renderDetail();
      notify(tickets.length ? 'Fila atualizada. Mostrando até 150 chamados recentes.' : 'Ainda não há chamados registrados.');
    } catch(error) {
      tickets=[];selectedId='';renderList();renderDetail();
      notify(error instanceof Error?error.message:'Não foi possível consultar os chamados.',true);
    } finally {loading=false;refresh.disabled=false;}
  }
  search.addEventListener('input',renderList);
  filterStatus.addEventListener('change',renderList);
  filterProduct.addEventListener('change',renderList);
  refresh.addEventListener('click',()=>void load());
  window.addEventListener('nexus:central:view',event=>{if(event.detail?.view==='support') void load();});
  if(location.hash==='#support' && typeof setView === 'function') setView('support');
})();
