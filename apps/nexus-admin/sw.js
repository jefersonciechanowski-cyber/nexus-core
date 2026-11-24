/* Nexus Central Web Push worker, intentionally without fetch/cache interception. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

const SUPPORT_ROUTE = '/apps/nexus-admin/#support';
self.addEventListener('push',event=>{
  if (!event.data) return;
  let message;
  try {message=event.data.json();} catch {return;}
  if (message?.version !== 1 || !['ticket','test'].includes(message.kind)) return;
  const test=message.kind === 'test';
  const notification = self.registration.showNotification(
    test ? 'Nexus Central · Teste de push' : 'Nexus Central · Novo chamado',
    {
      body:test ? 'Notificações do iPhone funcionando.' : 'Um chamado de suporte aguarda atendimento.',
      icon:'/apps/sst-controle/icon-192.png',
      badge:'/apps/sst-controle/icon-192.png',
      tag:test ? 'nexus-central-push-test':'nexus-central-new-support',
      renotify:true,
      requireInteraction:false,
      data:{path:SUPPORT_ROUTE},
    },
  );
  event.waitUntil(Promise.allSettled([
    notification,
    self.navigator?.setAppBadge ? self.navigator.setAppBadge(1) : Promise.resolve(),
  ]));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=new URL(SUPPORT_ROUTE,self.location.origin).href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const open=windows.find(w=>{
      try {
        const u=new URL(w.url);
        return u.origin === self.location.origin && u.pathname.startsWith('/apps/nexus-admin/');
      } catch {return false;}
    });
    if (self.navigator?.clearAppBadge) {
      try {await self.navigator.clearAppBadge();} catch {}
    }
    if (open) {
      try {await open.navigate(target);} catch {}
      await open.focus();
    } else {
      await self.clients.openWindow(target);
    }
  })());
});
