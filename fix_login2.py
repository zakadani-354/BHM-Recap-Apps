with open('index.html','r',encoding='utf-8') as f: html=f.read()
# Add password field after username input
old_input = '<input type="text" id="name" placeholder="Username" required'
new_input = '<input type="password" id="pass" placeholder="Password" required style="padding:12px 14px;border-radius:10px;border:1.5px solid #e2e8f0;font-size:14px;">\n      <input type="text" id="name" placeholder="Username" required'
html = html.replace(old_input, new_input)
# Fix logo src to logo.png (relative)
html = html.replace('src="logo.png"', 'src="logo.png"')
# If logo area still has mosque icon, replace whole block
if 'fa-solid fa-mosque' in html:
    html = html.replace('<div style="width:80px;height:80px;margin:0 auto 14px;background:linear-gradient(135deg,#059669,#064e3b);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;"><i class="fa-solid fa-mosque"></i></div>', '<img src="logo.png" style="width:80px;height:80px;margin:0 auto 14px;border-radius:50%;object-fit:cover;box-shadow:0 4px 16px rgba(6,78,59,.25);" alt="Logo">')
with open('index.html','w',encoding='utf-8') as f: f.write(html)
print('Login diperbaiki')
