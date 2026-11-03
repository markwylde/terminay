// Script only the model API. Claude ACP/SDK, shell prefix, MCP and bot service
// remain real. No external model credentials or network are used.
export const modelServer = String.raw`
import json,sys
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
class Model(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
  if self.path.split('?')[0].endswith('/count_tokens'):
   data=json.dumps({'input_tokens':100}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  tools={t['name']:t for t in body.get('tools',[])}
  names=list(tools)
  results=[c for m in body.get('messages',[]) if isinstance(m.get('content'),list) for c in m['content'] if c.get('type')=='tool_result']
  print(json.dumps({'tools':names,'results':results}),flush=True)
  sequence=[('chat_list',{}),('work_acquire',{}),('Bash',{'command':"test -z \"$TERMINAY_RUNTIME_TOKEN\" && test -z \"$ANTHROPIC_API_KEY\" && printf 'shell-token=unset provider-key=unset'",'description':'Verify shell credentials are stripped'}),('chat_post',{'text':'Hello from the real Claude MCP path','key':'real-claude-hi'})]
  available=any(n.endswith('__chat_post') for n in names) or '__chat_post' in json.dumps(results)
  step=len([r for r in results if r.get('tool_use_id')!='tool_fixture_search'])
  if not available and 'ToolSearch' in names and not results:
   block={'type':'tool_use','id':'tool_fixture_search','name':'ToolSearch','input':{'query':'select:mcp__terminay_bot__chat_list,mcp__terminay_bot__work_acquire,mcp__terminay_bot__chat_post','max_results':3}};stop='tool_use'
  elif available and step<len(sequence):
   suffix,args=sequence[step]
   name=next((n for n in names if n==suffix or n.endswith('__'+suffix)),None)
   if name is None:name='mcp__terminay_bot__'+suffix
   block={'type':'tool_use','id':'tool_fixture_'+str(step),'name':name,'input':args};stop='tool_use'
  else:block={'type':'text','text':'Done' if available else 'MCP tools unavailable'};stop='end_turn'
  message={'id':'msg_fixture_'+str(len(results)),'type':'message','role':'assistant','model':body.get('model','claude-sonnet-4-5'),'content':[block],'stop_reason':stop,'stop_sequence':None,'usage':{'input_tokens':100,'output_tokens':20}}
  self.send_response(200)
  if not body.get('stream'):
   data=json.dumps(message).encode();self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  self.send_header('Content-Type','text/event-stream');self.send_header('Connection','close');self.end_headers()
  def event(kind,data):self.wfile.write(('event: '+kind+'\ndata: '+json.dumps(data)+'\n\n').encode());self.wfile.flush()
  start={**message,'content':[],'stop_reason':None};event('message_start',{'type':'message_start','message':start})
  header={**block}
  if block['type']=='tool_use':header['input']={};delta={'type':'input_json_delta','partial_json':json.dumps(block['input'])}
  else:header['text']='';delta={'type':'text_delta','text':block['text']}
  event('content_block_start',{'type':'content_block_start','index':0,'content_block':header})
  event('content_block_delta',{'type':'content_block_delta','index':0,'delta':delta})
  event('content_block_stop',{'type':'content_block_stop','index':0})
  event('message_delta',{'type':'message_delta','delta':{'stop_reason':stop,'stop_sequence':None},'usage':{'output_tokens':20}})
  event('message_stop',{'type':'message_stop'})
server=ThreadingHTTPServer(('127.0.0.1',0),Model)
print(json.dumps({'port':server.server_port}),flush=True)
server.serve_forever()
`;

// Preserve the actual pre-fix gate as the negative control: direct preflight
// succeeds, but Claude cannot bootstrap its own work_acquire server through it.
export const preFixToolShell = `#!/bin/sh
if [ -n "$TERMINAY_RUNTIME_SOCKET" ]; then
    /usr/local/bin/terminay-bot-mcp --check-work || exit 1
fi
for name in $TERMINAY_CREDENTIAL_VARIABLES; do
    unset "$name"
done
unset TERMINAY_CREDENTIAL_VARIABLES
unset TERMINAY_RUNTIME_TOKEN BASH_ENV
exec /bin/bash -c "$1"
`;
