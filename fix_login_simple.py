with open('index.html','r',encoding='utf-8') as f: html=f.read()
# Remove role select from form
html = html.replace('<label style="font-size:13px;font-weight:600;color:#334155;">Peran</label><select id="role" style="padding:12px 14px;border-radius:12px;border:1.5px solid #e2e8f0;font-size:15px;background:#fff;cursor:pointer;"><option value="admin">Admin — Full Akses</option><option value="pengurus">Pengurus — Lihat & Download</option></select>', '')
with open('index.html','w',encoding='utf-8') as f: f.write(html)
print('Peran dihapus')
