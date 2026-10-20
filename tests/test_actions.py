from pathlib import Path
import tempfile
import types
import unittest
from beomdesk.actions import ActionCatalog


class FakeBridge:
    def __init__(self,features):
        self.features=features;self.opened=[];self.assets=Path(tempfile.gettempdir())
        self.calls=[];self.session=types.SimpleNamespace(require=lambda:object(),hwp=None)
        outer=self
        class Adapter:
            def __init__(self,obj):self.대상=obj
            def 글자크기(self,size):outer.calls.append(('font',size))
            def 문장(self,text):outer.calls.append(('text',text))
        self.context={'기본한컴':Adapter}
    def load(self):return self.context
    def open_screen(self,screen):self.opened.append(screen)


class ActionTests(unittest.TestCase):
    def test_original_literal_callback_keeps_operation_order(self):
        bridge=FakeBridge([{'callback_source':'def action():\n return [기본.글자크기(13), 기본.문장("제목")]','screen':'test'}])
        catalog=ActionCatalog(bridge,tempfile.gettempdir());catalog.execute(0)
        self.assertEqual(bridge.calls,[('font',13),('text','제목')])

    def test_input_dependent_callback_opens_original_screen(self):
        bridge=FakeBridge([{'callback_source':'def action():\n return 기본.글자크기(입력.get())','screen':'글자창'}])
        catalog=ActionCatalog(bridge,tempfile.gettempdir());catalog.execute(0)
        self.assertEqual(bridge.opened,['글자창']);self.assertFalse(bridge.calls)

    def test_arbitrary_python_and_private_attributes_rejected(self):
        for value in ['__import__("os").system("x")','기본.__class__()','eval("1")','기본.문장(*args)']:
            bridge=FakeBridge([{'callback_source':'def action():\n return '+value,'screen':'safe'}])
            catalog=ActionCatalog(bridge,tempfile.gettempdir())
            self.assertIsNone(catalog.expressions[0],value)


if __name__=='__main__':unittest.main()
