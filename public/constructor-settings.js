(()=>{
fetch('/constructor-settings.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(s=>{
 if(s?.version!==1)return;
 const apply=()=>{
  if(document.title!==s.title)document.title=s.title;
  if(document.documentElement.lang!==s.language)document.documentElement.lang=s.language;
  let meta=document.querySelector('meta[name="description"]');
  if(!meta){meta=document.createElement('meta');meta.name='description';document.head.append(meta)}
  if(meta.content!==s.description)meta.content=s.description;
 };
 apply();
 // Next navigation can replace metadata without reloading the root layout script.
 const observer=new MutationObserver(apply);
 observer.observe(document.head,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['content','name']});
 observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
}).catch(()=>{});
})();