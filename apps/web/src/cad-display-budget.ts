/** Presentation-only budget. Never clips source geometry or changes import/engineering limits. */
export const CAD_DISPLAY_LIMITS={segments:5000,vertices:150000};
export function cadDisplayBudget(doc:{entities:any[]}){
 let segments=0,vertices=0;
 for(const e of doc.entities)for(const s of e.segments){segments++;vertices+=s.kind==='line'?2:Math.max(65,Math.min(512,Math.max(8,Math.ceil(Math.abs(s.sweep)*32)))+1);}
 const allowed=segments<=CAD_DISPLAY_LIMITS.segments&&vertices<=CAD_DISPLAY_LIMITS.vertices;
 return {allowed,segments,vertices,limits:CAD_DISPLAY_LIMITS,diagnostic:allowed?null:`CAD görünüm bütçesi aşıldı: ${segments} parça / ${vertices} çizim noktası; sınır ${CAD_DISPLAY_LIMITS.segments} / ${CAD_DISPLAY_LIMITS.vertices}. Kaynak bütünüyle saklandı; çizim kırpılmadı. Görüntülemek için açıkça daha az katman seçin.`};
}
