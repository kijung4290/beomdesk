from pathlib import Path
import os,sys
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
if (ROOT/'.tools/python311/tcl').exists():
    os.environ['TCL_LIBRARY']=str(ROOT/'.tools/python311/tcl')
    os.environ['TK_LIBRARY']=str(ROOT/'.tools/python311/tk')
import PyInstaller.__main__
PyInstaller.__main__.run([
    str(ROOT/'backend.py'),'--noconfirm','--onedir','--console','--name','BeomBackend',
    '--distpath',str(ROOT/'backend-dist'),'--workpath',str(ROOT/'.build/backend-work'),
    '--specpath',str(ROOT/'.build'),'--paths',str(ROOT),
    '--add-data',str(ROOT/'assets')+os.pathsep+'assets',
    '--hidden-import','pythoncom','--hidden-import','win32api','--hidden-import','win32gui',
    '--hidden-import','win32com.client.gencache','--hidden-import','win32com.client.makepy',
    '--hidden-import','tkinter.filedialog','--hidden-import','tkinter.messagebox',
    '--hidden-import','random','--hidden-import','decimal','--hidden-import','copy',
    '--collect-submodules','win32com.client','--noupx'])
