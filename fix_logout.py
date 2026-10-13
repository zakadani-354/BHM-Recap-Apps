with open('index.html','r',encoding='utf-8') as f: html=f.read()
old='<nav class="nav-links">'
new='<nav class="nav-links"><a href="#" onclick="logoutApp();" class="nav-link" style="background:#fff;color:#064e3b;border:1px solid rgba(255,255,255,.4);"><i class="fa-solid fa-arrow-right-from-bracket"></i> Keluar</a>'
html=html.replace(old,new)
with open('index.html','w',encoding='utf-8') as f: f.write(html)
print('Tombol keluar ditambah')
