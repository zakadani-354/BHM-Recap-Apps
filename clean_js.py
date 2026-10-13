with open('js/app.js','r',encoding='utf-8',errors='ignore') as f: content=f.read()
idx=content.find('renderJamaah();')
if idx!=-1:
    clean=content[:idx+len('renderJamaah();')]
    clean += '\nwindow.logoutApp=function(){document.getElementById("view-login").style.display="flex";document.getElementById("main-header").style.display="none";document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));document.getElementById("page-dashboard").classList.remove("hidden");};\n'
    with open('js/app.js','w',encoding='utf-8') as f: f.write(clean)
    print('Bersih')
