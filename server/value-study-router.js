import { Router, json } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function createValueStudyRouter(service,{origin,csrf=randomBytes(32).toString('hex')}={}) {
  const router=Router();router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.use((req,res,next)=>{
    if(req.method==='GET')return next();
    const supplied=req.get('x-study-csrf')||'';
    if(req.get('origin')!==origin()||Buffer.byteLength(supplied)!==Buffer.byteLength(csrf)
      ||!timingSafeEqual(Buffer.from(supplied),Buffer.from(csrf)))return res.status(403).json({error:'请从主持人打开的对照页面操作。'});
    next();
  });
  router.use(json({limit:'64kb'}));
  const route=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){if(e.status||e.message?.startsWith('请'))res.status(e.status||400).json({error:e.message});else next(e);}};
  router.get('/config',route(()=>({...service.config(),csrf})));
  router.post('/sessions',route(req=>service.create(req.body)));
  router.get('/sessions/:id',route(req=>service.read(req.params.id)));
  router.post('/sessions/:id/start',route(req=>service.start(req.params.id)));
  router.put('/sessions/:id/draft',route(req=>service.draft(req.params.id,req.body)));
  router.post('/sessions/:id/analyze',route(req=>service.analyze(req.params.id)));
  router.post('/sessions/:id/finish',route(req=>service.finish(req.params.id,req.body)));
  router.post('/sessions/:id/interrupt',route(req=>service.interrupt(req.params.id)));
  router.post('/sessions/:id/review/:index',route(req=>service.review(req.params.id,Number(req.params.index),req.body)));
  router.get('/summary',route(()=>service.summary()));
  router.get('/export',route(()=>service.export()));
  router.use((req,res)=>res.status(404).json({error:'对照接口不存在。'}));
  router.use((error,req,res,next)=>{
    const tooLarge=error.type==='entity.too.large',invalid=error.type==='entity.parse.failed';
    res.status(tooLarge?413:invalid?400:503).json({error:tooLarge?'记录内容过长。':invalid?'记录格式不正确。':'对照记录暂时不可用，请主持人检查保存目录。'});
  });
  return router;
}
