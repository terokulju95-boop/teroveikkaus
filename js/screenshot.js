// KULJU CUP – tulostaulun kuvakaappaus (html2canvas)
// Eriytetty index.html:stä. Sisältö on siirretty sellaisenaan, ilman muutoksia.

document.getElementById('screenshotTableBtn').addEventListener('click', async ()=>{
  try{
    const area=document.getElementById('predictionsArea');
    const target=area.querySelector('.table-wrap')||area;
    const canvas=await html2canvas(target,{scale:3,backgroundColor:null,useCORS:true,windowWidth:target.scrollWidth,windowHeight:target.scrollHeight});
    const link=document.createElement('a'); link.download='veikkaus.png'; link.href=canvas.toDataURL('image/png');
    document.body.appendChild(link); link.click(); link.remove();
  }catch(e){ alert('Kuvan luonti epäonnistui: '+(e&&e.message?e.message:e)); }
});
