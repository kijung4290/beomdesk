"""Explicit compatibility bridge to extracted Python 3.11 application components.

The original main module is NEVER executed. Only its named function definitions
are bound, so its COM-cache deletion and startup code are not run.
"""
from pathlib import Path
from datetime import datetime, timedelta
import hashlib
import importlib.util
import json
import marshal
import os
import shutil
import sys
import types


def asset_root():
    return Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parents[1]))/'assets'


class LegacyBridge:
    def __init__(self, root, session):
        self.root=root
        self.session=session
        self.assets=asset_root()
        self.context=None
        self.features=json.loads((self.assets/'feature-map.json').read_text(encoding='utf-8'))

    def _code(self,name):
        path=self.assets/'legacy'/(name+'.pyc')
        data=path.read_bytes()
        manifest=json.loads((self.assets/'source-manifest.json').read_text(encoding='utf-8'))
        expected=next(x['sha256'] for x in manifest if x['output'].replace('\\','/').endswith('/'+name+'.pyc'))
        if hashlib.sha256(data).hexdigest()!=expected:
            raise RuntimeError('호환 구성 파일의 무결성 확인에 실패했습니다.')
        if data[:4]!=importlib.util.MAGIC_NUMBER:
            raise RuntimeError('호환 도구는 Python 3.11 실행 환경이 필요합니다.')
        return marshal.loads(data[16:])

    def load(self):
        if self.context is not None:
            return self.context
        import tkinter
        import pythoncom
        from win32com.client.gencache import EnsureDispatch
        from win32gui import FindWindow, MoveWindow
        ui=types.ModuleType('_beom_legacy_ui')
        ui.__file__=str(self.assets/'legacy/interface.py')
        exec(self._code('인터페이스.인터페이스'),ui.__dict__)
        ui.__dict__['이미지']=lambda name:str(self.assets/Path(name.replace('\\','/')))
        library=types.ModuleType('_beom_legacy_hwp')
        library.__file__=str(self.assets/'legacy/hwp.py')
        exec(self._code('한컴오피스.한컴라이브러리'),library.__dict__)
        context={'__name__':'_beom_legacy_functions','__file__':str(self.assets/'legacy/main.py'),
                 '__builtins__':__builtins__,'datetime':datetime,'timedelta':timedelta,
                 'pythoncom':pythoncom,'EnsureDispatch':EnsureDispatch,'FindWindow':FindWindow,
                 'MoveWindow':MoveWindow,'os':os,'shutil':shutil,'창':self.root}
        context.update({key:value for key,value in tkinter.__dict__.items() if not key.startswith('_')})
        context.update({key:value for key,value in ui.__dict__.items() if not key.startswith('_')})
        context['기본한컴']=library.__dict__['기본한컴']
        main_code=self._code('메인')
        for value in main_code.co_consts:
            if isinstance(value,types.CodeType) and value.co_name.isidentifier() and not value.co_freevars:
                context[value.co_name]=types.FunctionType(value,context,value.co_name)
        self.context=context
        return context

    def open_screen(self,screen):
        import tkinter as tk
        context=self.load()
        self.adapter()
        function=context.get(screen)
        if not callable(function):
            raise RuntimeError('선택한 화면의 구성 함수를 찾지 못했습니다.')
        if function.__code__.co_argcount==0:
            function()
            return None
        if function.__code__.co_argcount!=5:
            raise RuntimeError('이 화면은 전용 입력 화면에서 실행해야 합니다.')
        window=tk.Toplevel(self.root)
        window.title('원본 도구 · '+screen.removesuffix('프레임'))
        window.geometry('650x820')
        canvas=tk.Canvas(window,background='white',highlightthickness=0)
        scroll=tk.Scrollbar(window,orient='vertical',command=canvas.yview)
        canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side='right',fill='y')
        canvas.pack(fill='both',expand=True)
        inner=tk.Frame(canvas,width=620,height=1400,bg='white')
        canvas.create_window(0,0,window=inner,anchor='nw')
        function(inner,0,0,620,1400)
        canvas.configure(scrollregion=(0,0,620,1400))
        return window

    def adapter(self):
        context=self.load()
        target=self.session.require()
        generation=getattr(self.session,'generation',0)
        if '기본' not in context or context.get('_session_generation')!=generation:
            context['기본']=context['기본한컴'](target)
            context['_session_generation']=generation
        self.session.hwp=context['기본'].대상
        context['한컴']=self.session.hwp
        return context['기본']

    def sync_session(self):
        if self.context and '기본' in self.context and self.context.get('_session_generation')==getattr(self.session,'generation',0):
            self.session.hwp=self.context['기본'].대상
