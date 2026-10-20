"""Create an isolated, unsaved HWP document. Never attaches to user documents."""
from pathlib import Path
import json
import os
import sys
import traceback
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
os.environ['TCL_LIBRARY']=str(ROOT/'.tools/python311/tcl')
os.environ['TK_LIBRARY']=str(ROOT/'.tools/python311/tk')
import tkinter as tk
from beomdesk.document import parse_document
from beomdesk.hwp import HwpSession
from beomdesk.legacy import LegacyBridge
from beomdesk.actions import ActionCatalog

session=HwpSession();root=None
result={'passed':False,'isolated_document':True}
try:
    session.connect(new=True,visible=False)
    session.render(parse_document('제목: 범피스 구현 검증\n네모: 정상 입력\n표: 항목: 결과\n표: 문서: 성공\n표: 표 생성: 확인\n본문: 문서 끝 확인'),new=False)
    text=session.hwp.GetTextFile('TEXT','')
    for value in ['범피스 구현 검증','정상 입력','항목','문서','성공','표 생성','문서 끝 확인']:
        assert value in text,(value,text)
    session.run('SelectAll');session.set_font(size=13,bold=True)
    shape=session.hwp.CharShape
    assert shape.Item('Height')==1300,shape.Item('Height')
    session.run('MoveDocEnd')
    root=tk.Tk();root.withdraw()
    bridge=LegacyBridge(root,session)
    context=bridge.load()
    adapter=context['기본한컴'](session.hwp)
    adapter.문장('호환 문장 입력 확인')
    assert '호환 문장 입력 확인' in session.hwp.GetTextFile('TEXT','')
    catalog=ActionCatalog(bridge,ROOT/'test-results')
    direct_id=next(i for i,f in enumerate(bridge.features) if f['control']=='기본서식사회자버튼')
    assert catalog.execute(direct_id)['direct']
    assert '사회자' in session.hwp.GetTextFile('TEXT','')
    window=bridge.open_screen('표프레임')
    root.update_idletasks()
    def descendants(widget):
        for child in widget.winfo_children():
            yield child
            yield from descendants(child)
    count=sum(isinstance(w,tk.Button) for w in descendants(window))
    assert count>=40,count
    window.destroy()
    export=ROOT/'test-results/integration-document.hwpx'
    export.parent.mkdir(exist_ok=True)
    session.save_as(export)
    import zipfile
    with zipfile.ZipFile(export) as archive:
        assert 'Contents/section0.xml' in archive.namelist()
    result.update(passed=True,rendered_text=text,applied_font_height=shape.Item('Height'),
                  legacy_insert_verified=True,legacy_table_screen_buttons=count,
                  direct_catalog_action=direct_id,saved_hwpx_verified=True)
except Exception:
    result['error']=traceback.format_exc()
    raise
finally:
    if root is not None:root.destroy()
    try:session.close_owned()
    except Exception:result['cleanup_error']=traceback.format_exc()
    (ROOT/'integration-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
