import ast
from datetime import date
from decimal import Decimal, InvalidOperation
import operator


def date_difference(start,end):
    a=date.fromisoformat(start.strip())
    b=date.fromisoformat(end.strip())
    return (b-a).days


def calculate(expression):
    if len(expression)>300:
        raise ValueError('계산식은 300자 이내로 입력해 주세요.')
    tree=ast.parse(expression.replace(',',''),mode='eval')
    operations={ast.Add:operator.add,ast.Sub:operator.sub,ast.Mult:operator.mul,
                ast.Div:operator.truediv,ast.Mod:operator.mod}
    def visit(node,depth=0):
        if depth>30:
            raise ValueError('계산식이 너무 복잡합니다.')
        if isinstance(node,ast.Constant) and type(node.value) in (int,float):
            return Decimal(str(node.value))
        if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.UAdd,ast.USub)):
            value=visit(node.operand,depth+1)
            return value if isinstance(node.op,ast.UAdd) else -value
        if isinstance(node,ast.BinOp) and type(node.op) in operations:
            return operations[type(node.op)](visit(node.left,depth+1),visit(node.right,depth+1))
        raise ValueError('숫자와 +, -, *, /, %, 괄호만 사용할 수 있습니다.')
    try:
        result=visit(tree.body)
        if not result.is_finite():
            raise ValueError('유한한 숫자로 계산할 수 없습니다.')
        return result
    except (ArithmeticError,InvalidOperation) as exc:
        raise ValueError('0으로 나누거나 범위를 벗어난 계산인지 확인해 주세요.') from exc
