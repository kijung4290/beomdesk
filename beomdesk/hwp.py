"""Maintainable HWP COM operations used by the new desktop interface."""
from pathlib import Path


class HwpSession:
    def __init__(self):
        self.hwp = None
        self.owned = False
        self.generation = 0

    def connect(self, new=False, visible=True):
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        obj=None
        if not new:
            try:
                table=pythoncom.GetRunningObjectTable()
                bind=pythoncom.CreateBindCtx(0)
                for moniker in table.EnumRunning():
                    if moniker.GetDisplayName(bind, moniker).startswith('!HwpObject'):
                        obj=win32com.client.gencache.EnsureDispatch(table.GetObject(moniker).QueryInterface(pythoncom.IID_IDispatch))
                        break
            except pythoncom.com_error:
                obj=None
        if obj is None:
            try:
                raw=win32com.client.DispatchEx('HWPFrame.HwpObject')
                obj=win32com.client.gencache.EnsureDispatch(raw)
            except Exception as exc:
                raise RuntimeError('한글에 연결하지 못했습니다. 한컴오피스 한글 설치와 실행 상태를 확인해 주세요.') from exc
            self.owned=True
        else:
            self.owned=False
        obj.XHwpWindows.Item(0).Visible=visible
        # Reuse an explicitly registered local Hancom security module if present.
        # No module is downloaded, registered in Windows, or installed here.
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\HNC\HwpAutomation\Modules') as key:
                for name in ('FilePathCheckerModule','FilePathCheckerModuleExample'):
                    try:
                        module_path,_=winreg.QueryValueEx(key,name)
                        if Path(module_path).is_file() and obj.RegisterModule('FilePathCheckDLL',name):break
                    except OSError:continue
        except (OSError,pythoncom.com_error):pass
        self.hwp=obj
        self.generation += 1
        return self

    def require(self):
        if self.hwp is None:
            self.connect()
        return self.hwp

    def run(self, action):
        result=self.require().HAction.Run(action)
        if result is False:
            raise RuntimeError(f'현재 문서 위치에서 실행할 수 없습니다: {action}')
        return result

    def apply(self, action, values):
        obj=self.require()
        act=obj.CreateAction(action)
        params=act.CreateSet()
        act.GetDefault(params)
        for name,value in values.items():
            params.SetItem(name,value)
        result=act.Execute(params)
        if result is False:
            raise RuntimeError(f'한글이 작업을 적용하지 못했습니다: {action}')
        return result

    def insert(self, text):
        return self.apply('InsertText',{'Text':text})

    def new_document(self):
        self.run('FileNew')

    def set_font(self, family='맑은 고딕', size=11, bold=False):
        if not 1<=float(size)<=200:
            raise ValueError('글자 크기는 1~200pt 범위로 입력해 주세요.')
        values={'Height':round(float(size)*100),'Bold':int(bool(bold))}
        for script in ('Hangul','Latin','Hanja','Japanese','Other','Symbol','User'):
            values['FaceName'+script]=family
            values['FontType'+script]=1
        self.apply('CharShape',values)

    def set_spacing(self, percent=160):
        if not 50<=int(percent)<=500:
            raise ValueError('줄 간격은 50~500% 범위로 입력해 주세요.')
        self.apply('ParagraphShape',{'LineSpacingType':0,'LineSpacing':int(percent)})

    def align(self, alignment):
        return self.run({'left':'ParagraphShapeAlignLeft','center':'ParagraphShapeAlignCenter',
                         'right':'ParagraphShapeAlignRight','justify':'ParagraphShapeAlignJustify'}[alignment])

    def zero_cell_margins(self):
        values={f'CellMargin{edge}':0 for edge in ('Top','Bottom','Left','Right')}
        values.update(ShapeType=3,ShapeCellSize=0)
        self.apply('TablePropertyDialog',values)

    def table(self, rows):
        if not rows or not rows[0]:
            raise ValueError('표에는 행과 열이 필요합니다.')
        obj=self.require()
        columns=max(map(len,rows))
        action=obj.CreateAction('TableCreate')
        params=action.CreateSet()
        action.GetDefault(params)
        for key,value in {'Rows':len(rows),'Cols':columns,'WidthType':2,'HeightType':1}.items():
            params.SetItem(key,value)
        widths=params.CreateItemArray('ColWidth',columns)
        for i in range(columns):
            widths.SetItem(i,obj.MiliToHwpUnit(170/columns))
        heights=params.CreateItemArray('RowHeight',len(rows))
        for i in range(len(rows)):
            heights.SetItem(i,obj.MiliToHwpUnit(8))
        properties=params.Item('TableProperties')
        properties.SetItem('TreatAsChar',1)
        if action.Execute(params) is False:
            raise RuntimeError('표를 만들지 못했습니다.')
        for row_i,row in enumerate(rows):
            for col_i in range(columns):
                self.set_font(size=10,bold=row_i==0)
                self.insert(row[col_i] if col_i<len(row) else '')
                if row_i!=len(rows)-1 or col_i!=columns-1:
                    self.run('TableRightCell')
        self.run('CloseEx')
        self.run('MoveRight')
        self.run('BreakPara')

    def render(self, blocks, new=True):
        if new:
            self.new_document()
        for block in blocks:
            if block.kind=='table':
                self.table(block.rows)
                continue
            size=20 if block.kind=='heading' and block.level==1 else 14 if block.kind=='heading' else 10 if block.kind=='note' else 11
            self.set_font(size=size,bold=block.kind=='heading')
            self.align('center' if block.kind=='heading' and block.level==1 else 'left')
            self.set_spacing(160)
            prefix={1:'□ ',2:' ○ ',3:'   - '}.get(block.level,'') if block.kind=='bullet' else '※ ' if block.kind=='note' else ''
            if block.kind!='gap':
                self.insert(prefix+block.text)
            self.run('BreakPara')

    def open(self, path):
        self.new_document()
        if self.require().Open(str(Path(path).resolve())) is False:
            raise RuntimeError('한글이 서식 파일을 열지 못했습니다.')

    def save_as(self,path):
        path=Path(path).resolve()
        fmt='HWPX' if path.suffix.lower()=='.hwpx' else 'HWP'
        if self.require().SaveAs(str(path),fmt,'') is False:
            raise RuntimeError('문서를 저장하지 못했습니다.')

    def close_owned(self):
        if self.hwp is not None and self.owned:
            self.hwp.Clear(1)
            self.hwp.Quit()
        self.hwp=None
