"""Local JSON-lines service. Tk and COM operations stay on their owning thread."""
from pathlib import Path
import contextlib
import json
import logging
import os
import queue
import sys
import threading
import traceback
import uuid

for stream in (sys.stdin,sys.stdout,sys.stderr):
    if stream is not None and hasattr(stream,'reconfigure'):
        stream.reconfigure(encoding='utf-8',errors='replace')

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
if not getattr(sys,'frozen',False):
    os.environ.setdefault('TCL_LIBRARY',str(ROOT/'.tools/python311/tcl'))
    os.environ.setdefault('TK_LIBRARY',str(ROOT/'.tools/python311/tk'))
import tkinter as tk
from beomdesk.document import parse_document,plain_text,to_html,SAMPLES
from beomdesk.calculations import calculate,date_difference
from beomdesk.hwp import HwpSession
from beomdesk.legacy import LegacyBridge,asset_root
from beomdesk.actions import ActionCatalog


class Backend:
    def __init__(self):
        self.root=tk.Tk();self.root.withdraw()
        self.session=HwpSession();self.bridge=LegacyBridge(self.root,self.session)
        self.requests=queue.Queue(maxsize=100)
        self.output=sys.stdout
        self.stopping=False
        self.data=Path(os.environ.get('BEOM_DATA_DIR',Path.home()/'BeomDesk'))
        self.data.mkdir(parents=True,exist_ok=True)
        logging.basicConfig(filename=self.data/'backend.log',encoding='utf-8',level=logging.INFO)
        self.templates=sorted(asset_root().rglob('*.hwp'))+sorted(asset_root().rglob('*.hwpx'))
        self.catalog=ActionCatalog(self.bridge,self.data)
        self.root.report_callback_exception=self.callback_error

    def send(self,value):
        self.output.write(json.dumps(value,ensure_ascii=False)+'\n');self.output.flush()

    def callback_error(self,kind,value,tb):
        logging.error('Compatibility tool failed',exc_info=(kind,value,tb))
        self.send({'event':'tool-error','message':str(value)})

    def read_input(self):
        try:
            for line in sys.stdin:
                if len(line)>1500000:
                    self.send({'event':'tool-error','message':'요청 크기가 너무 큽니다.'});continue
                try:self.requests.put(json.loads(line),timeout=2)
                except (ValueError,queue.Full):self.send({'event':'tool-error','message':'요청을 처리하지 못했습니다.'})
        finally:self.stopping=True

    def dispatch(self,method,params):
        if not isinstance(params,dict):raise ValueError('잘못된 작업 인수입니다.')
        self.bridge.sync_session()
        if method=='bootstrap':
            return {'samples':SAMPLES,'features':[{'id':i,'label':x['control'].removesuffix('버튼'),
                     'screen':x['screen'],'category':x['image'].replace('\\','/').split('/')[1].removesuffix('탭'),
                     'image':x['image'].replace('\\','/'),'direct':self.catalog.expressions[i] is not None} for i,x in enumerate(self.bridge.features)],
                    'templates':[{'id':i,'name':p.name,'category':p.parent.name} for i,p in enumerate(self.templates)],
                    'connected':self.session.hwp is not None}
        if method=='preview':
            blocks=parse_document(str(params.get('text','')))
            return {'blocks':[{'kind':b.kind,'text':b.text,'rows':b.rows,'level':b.level} for b in blocks],
                    'html':to_html(blocks),'plain':plain_text(blocks)}
        if method=='connect':
            self.session.connect();return {'connected':True}
        if method=='render':
            text=str(params.get('text',''))
            if not text.strip():raise ValueError('문서 내용을 먼저 입력해 주세요.')
            blocks=parse_document(text)
            self.session.render(blocks,new=True)
            return {'connected':True,'blocks':len(blocks),'tables':sum(b.kind=='table' for b in blocks)}
        if method=='command':
            allowed={'CharShapeBold','CharShapeUnderline','CharShapeItalic','ParagraphShapeAlignLeft',
                     'ParagraphShapeAlignCenter','ParagraphShapeAlignRight','ParagraphShapeAlignJustify',
                     'Undo','TableInsertLowerRow','TableDeleteRow','TableMergeCell','TableDistributeCellWidth',
                     'TableDistributeCellHeight','FileNew','MoveDocBegin','MoveDocEnd','SelectAll'}
            action=params.get('action')
            if action not in allowed:raise ValueError('지원하지 않는 편집 동작입니다.')
            self.session.run(action);return {'connected':True}
        if method=='font':
            self.session.set_font(str(params.get('family','맑은 고딕')),float(params.get('size',11)))
            return {'connected':True}
        if method=='spacing':
            self.session.set_spacing(int(params.get('percent',160)));return {'connected':True}
        if method=='cell_margins':
            self.session.zero_cell_margins();return {'connected':True}
        if method=='save_hwp':
            self.session.save_as(params['path']);return {'saved':True}
        if method=='open_feature':
            number=int(params['id'])
            if not 0<=number<len(self.bridge.features):raise ValueError('도구를 찾지 못했습니다.')
            self.bridge.open_screen(self.bridge.features[number]['screen'])
            return {'connected':True,'screen':self.bridge.features[number]['screen']}
        if method=='execute_feature':return self.catalog.execute(int(params['id']))
        if method in ('template_open','template_copy'):
            import shutil
            number=int(params['id'])
            if not 0<=number<len(self.templates):raise ValueError('서식을 찾지 못했습니다.')
            source=self.templates[number]
            if method=='template_copy':
                path=Path(params['path']);shutil.copy2(source,path)
            else:
                folder=self.data/'working';folder.mkdir(exist_ok=True)
                path=folder/(source.stem+'_'+uuid.uuid4().hex[:8]+source.suffix)
                shutil.copy2(source,path);self.session.open(path)
            return {'path':str(path),'connected':self.session.hwp is not None}
        if method=='calculate':return {'value':f'{calculate(str(params["expression"])):,f}'}
        if method=='date_difference':return {'days':date_difference(params['start'],params['end'])}
        if method=='self_test':
            return {'python':sys.version.split()[0],'features':len(self.bridge.features),
                    'templates':len(self.templates),'legacyDefinitions':sum(callable(x) for x in self.bridge.load().values())}
        if method=='shutdown':self.stopping=True;return {'closed':True}
        raise ValueError('지원하지 않는 작업입니다.')

    def tick(self):
        if self.stopping:
            self.root.destroy();return
        try:request=self.requests.get_nowait()
        except queue.Empty:self.root.after(30,self.tick);return
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result=self.dispatch(request.get('method'),request.get('params',{}))
            self.send({'id':request.get('id'),'ok':True,'result':result})
        except Exception as exc:
            logging.exception('Backend operation failed')
            self.send({'id':request.get('id'),'ok':False,'error':str(exc) or type(exc).__name__})
        self.root.after(10,self.tick)

    def run(self):
        threading.Thread(target=self.read_input,daemon=True).start()
        self.root.after(10,self.tick);self.root.mainloop()


if __name__=='__main__':Backend().run()
