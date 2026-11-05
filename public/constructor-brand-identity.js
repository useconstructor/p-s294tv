(()=>{
fetch('/constructor-brand-identity.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(b=>{
 if(b?.version!==1)return;
 let scheduled=false;
 const apply=()=>{scheduled=false;
  if(b.logoText)for(const element of document.querySelectorAll('header a,header span,nav a,nav span,[data-brand-name]')){
   if(element.children.length===0&&(element.hasAttribute('data-brand-name')||b.previousNames.includes(element.textContent.trim()))&&element.textContent!==b.logoText)element.textContent=b.logoText;
  }
  if(b.logoImageUrl)for(const image of document.querySelectorAll('header img,nav img,img[data-brand-logo]')){
   if((image.hasAttribute('data-brand-logo')||b.previousImages.includes(image.getAttribute('src')))&&image.getAttribute('src')!==b.logoImageUrl){image.setAttribute('src',b.logoImageUrl);image.setAttribute('alt',b.logoText||'Logo')}
  }
  if(b.faviconImageUrl)for(const icon of document.querySelectorAll('link[rel="icon"],link[rel="shortcut icon"]'))if(icon.getAttribute('href')!==b.faviconImageUrl)icon.setAttribute('href',b.faviconImageUrl);
 };
 apply();new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(apply)}}).observe(document.documentElement,{childList:true,subtree:true});
}).catch(()=>{});
})();