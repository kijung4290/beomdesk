"""Execute only statically recognized original callbacks, without eval/exec."""
import ast
from pathlib import Path
import shutil
import uuid


class ActionCatalog:
    def __init__(self,bridge,data_dir):
        self.bridge=bridge;self.data_dir=Path(data_dir)
        self.expressions=[]
        for feature in bridge.features:
            try:
                tree=ast.parse(feature['callback_source'])
                function=tree.body[0]
                if not isinstance(function,ast.FunctionDef) or len(function.body)!=1 or not isinstance(function.body[0],ast.Return):
                    raise ValueError('Input screen required')
                expression=function.body[0].value
                self.check(expression)
                self.expressions.append(expression)
            except (SyntaxError,ValueError,KeyError,TypeError):self.expressions.append(None)

    def path(self,node):
        if isinstance(node,ast.Name):return [node.id]
        if isinstance(node,ast.Attribute):return self.path(node.value)+[node.attr]
        raise ValueError('Unknown call target')

    def check(self,node):
        if isinstance(node,ast.Constant) and isinstance(node.value,(str,int,float,bool,type(None))):return
        if isinstance(node,(ast.List,ast.Tuple)):
            for item in node.elts:self.check(item)
            return
        if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.USub,ast.UAdd)):
            if not isinstance(node.operand,ast.Constant) or type(node.operand.value) not in (int,float):raise ValueError('Not numeric')
            return
        if not isinstance(node,ast.Call):raise ValueError('Input value required')
        target=self.path(node.func)
        if any(part.startswith('_') for part in target):raise ValueError('Private method')
        if target[0]=='기본' and len(target)==2:pass
        elif target[:3]==['기본','대상','HAction'] and target[3:]==['Run']:pass
        elif target==['기본','대상','Open']:pass
        elif target==['이미지']:pass
        else:raise ValueError('Original input screen required')
        for item in node.args:self.check(item)
        for item in node.keywords:
            if item.arg is None:raise ValueError('Expanded arguments unsupported')
            self.check(item.value)

    def execute(self,index):
        if not 0<=index<len(self.expressions):raise ValueError('도구를 찾지 못했습니다.')
        expression=self.expressions[index]
        if expression is None:
            self.bridge.open_screen(self.bridge.features[index]['screen'])
            return {'direct':False,'connected':True}
        context=self.bridge.load()
        context['기본']=context['기본한컴'](self.bridge.session.require())
        context['한컴']=self.bridge.session.hwp
        adapter=context['기본']
        def visit(node):
            if isinstance(node,ast.Constant):return node.value
            if isinstance(node,(ast.List,ast.Tuple)):return [visit(item) for item in node.elts]
            if isinstance(node,ast.UnaryOp):return -node.operand.value if isinstance(node.op,ast.USub) else node.operand.value
            target=self.path(node.func)
            args=[visit(item) for item in node.args]
            kwargs={item.arg:visit(item.value) for item in node.keywords}
            if target==['이미지']:
                file=(self.bridge.assets/str(args[0]).replace('\\','/')).resolve()
                if not file.is_relative_to(self.bridge.assets.resolve()):raise ValueError('서식 경로가 올바르지 않습니다.')
                return str(file)
            if target==['기본','대상','Open']:
                source=Path(args[0]).resolve()
                if not source.is_relative_to(self.bridge.assets.resolve()) or source.suffix.lower() not in ('.hwp','.hwpx'):
                    raise ValueError('포함된 한글 서식만 열 수 있습니다.')
                working=self.data_dir/'working';working.mkdir(parents=True,exist_ok=True)
                copy=working/(source.stem+'_'+uuid.uuid4().hex[:8]+source.suffix)
                shutil.copy2(source,copy);args[0]=str(copy)
            obj=adapter
            for part in target[1:]:obj=getattr(obj,part)
            return obj(*args,**kwargs)
        visit(expression)
        self.bridge.session.hwp=adapter.대상
        return {'direct':True,'connected':True}
