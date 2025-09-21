#!/usr/bin/env python3
import os,sys,json,time
import subprocess
import requests
root=os.path.dirname(__file__)
root=os.path.dirname(root)
envfile=os.path.join(root,'.env')
if not os.path.exists(envfile):
    print('.env not found', file=sys.stderr); sys.exit(1)
env={}
with open(envfile) as f:
    for line in f:
        line=line.strip()
        if not line or line.startswith('#'): continue
        if line.startswith('export '): line=line[len('export '):]
        if '=' in line:
            k,v=line.split('=',1)
            env[k.strip()]=v.strip().strip('"').strip("'")
CLIENT_ID=env.get('CLIENT_ID')
CLIENT_SECRET=env.get('CLIENT_SECRET')
if not CLIENT_ID:
    print('CLIENT_ID missing'); sys.exit(1)
with open(os.path.join(root,'token.json')) as f:
    tok=json.load(f)
REFRESH_TOKEN=tok.get('refresh_token')
INSTANCE=tok.get('instance_url')
if not REFRESH_TOKEN or not INSTANCE:
    print('missing refresh_token or instance_url'); sys.exit(1)
url=INSTANCE.rstrip('/') + '/services/oauth2/token'
print('POST', url)
payload={'grant_type':'refresh_token','client_id':CLIENT_ID,'refresh_token':REFRESH_TOKEN}
if CLIENT_SECRET:
    payload['client_secret']=CLIENT_SECRET
r=requests.post(url, data=payload, timeout=15)
print('HTTP', r.status_code)
print(r.text[:1000])
if r.status_code!=200:
    print('refresh failed', file=sys.stderr)
    sys.exit(2)
new=r.json()
# merge
tok.update(new)
if 'issued_at' not in tok:
    tok['issued_at']=str(int(time.time()*1000))
with open(os.path.join(root,'token.json'),'w') as f:
    json.dump(tok,f,indent=2)
os.makedirs(os.path.join(root,'public'), exist_ok=True)
with open(os.path.join(root,'public','token.json'),'w') as f:
    json.dump(tok,f,indent=2)
print('WROTE token.json and public/token.json')
# probe proxied endpoint
probe='http://127.0.0.1:5173/services/apexrest/v1/duplicate-matches?status=pending&expand=customerA,customerB'
try:
    pr=requests.get(probe, headers={'Authorization':'Bearer '+tok['access_token'],'Origin':'http://127.0.0.1:5173'}, timeout=15)
    print('probe HTTP', pr.status_code)
    print('ACAO', pr.headers.get('Access-Control-Allow-Origin'))
    print(pr.text[:1000])
except Exception as e:
    print('probe error', e, file=sys.stderr)
    sys.exit(3)
print('done')
