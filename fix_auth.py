with open('js/app.js','r',encoding='utf-8') as f: js=f.read()
old='function doLogin(){'
new='function doLogin(){\n  const u=document.getElementById("name").value.trim().toLowerCase();\n  const p=document.getElementById("pass").value;\n  const r=document.getElementById("role").value;\n  if((u==="admin"&&p==="admin123")||(u==="pengurus"&&p==="pengurus123")){\n    document.getElementById("view-login").style.display="none";\n    document.getElementById("main-header").style.display="block";\n    window.currentRole=r;\n    if(r==="pengurus"){\n      document.getElementById("tab-input").style.display="none";\n      document.querySelector(".tabs .tab:first-child").style.display="none";\n      document.getElementById("jamaah-satuan").style.display="none";\n    }\n    showPage("dashboard");\n  }else{\n    alert("Username atau password salah!");\n  }\n}\nfunction doLoginOld(){'
js = js.replace(old, new)
with open('js/app.js','w',encoding='utf-8') as f: f.write(js)
print('Kredensial dibuat')
