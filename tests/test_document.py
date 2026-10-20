import unittest
from beomdesk.document import parse_document,to_html,plain_text
from beomdesk.calculations import calculate,date_difference


class DocumentTests(unittest.TestCase):
    def test_mixed_document_preserves_order_and_unknown_colons(self):
        blocks=parse_document('제목: 운영 계획\n일시: 14:30\nhttps://example.com\n표: 항목: 금액\n표: 식비: 10000\n원: 준비')
        self.assertEqual([b.kind for b in blocks],['heading','paragraph','paragraph','table','bullet'])
        self.assertIn('일시: 14:30',plain_text(blocks))
        self.assertIn('https://example.com',plain_text(blocks))

    def test_table_cells_pad_and_escaped_colon(self):
        block=parse_document('표: 이름: 안내\n표: 담당자: https\\://example.com\n표: 합계')[0]
        self.assertEqual(block.rows[-1],('합계',''))
        self.assertEqual(block.rows[1][1],'https://example.com')

    def test_standard_markdown_table_and_heading(self):
        blocks=parse_document('# 제목\n| 항목 | 결과 |\n| :--- | ---: |\n| 인원 | 30 |')
        self.assertEqual(len(blocks[1].rows),2)
        self.assertEqual(blocks[0].level,1)

    def test_html_is_inert(self):
        html=to_html(parse_document('본문: <script>alert(1)</script>\n표: <img onerror=x>: &'))
        self.assertNotIn('<script>',html)
        self.assertIn('&lt;script&gt;',html)
        self.assertIn('&amp;',html)

    def test_oversized_table_rejected_before_render(self):
        with self.assertRaises(ValueError):parse_document('\n'.join('표: x: y' for _ in range(201)))

    def test_decimal_calculation(self):
        self.assertEqual(str(calculate('0.1 + 0.2')),'0.3')
        self.assertEqual(calculate('(1,000 - 100) * 0.1'),90)
        with self.assertRaises(ValueError):calculate('__import__("os")')
        with self.assertRaises(ValueError):calculate('1/0')

    def test_calendar_boundaries(self):
        self.assertEqual(date_difference('2024-02-28','2024-03-01'),2)
        self.assertEqual(date_difference('2026-10-21','2026-10-20'),-1)


if __name__=='__main__':unittest.main()
