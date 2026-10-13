with open('index.html','r',encoding='utf-8') as f: html=f.read()
old='width:80px;height:80px;margin:0 auto 14px;background:linear-gradient(135deg,#059669,#064e3b);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;><i class="fa-solid fa-mosque"></i>'
new='width:80px;height:80px;margin:0 auto 14px;border-radius:50%;object-fit:cover;box-shadow:0 8px 20px rgba(6,78,59,.25);" alt="Logo" src="logo.png">'
html = html.replace(old, new)
with open('index.html','w',encoding='utf-8') as f: f.write(html)
print('Logo diganti ke logo.png')
