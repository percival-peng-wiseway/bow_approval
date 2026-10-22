from pathlib import Path
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).parent / 'fixtures'
root.mkdir(exist_ok=True)
lines = [
    'Harbour Office Pty Ltd', 'TAX INVOICE', 'ABN: 12 345 678 901',
    'Invoice Number: INV-2026-1042', 'Invoice Date: 16 October 2026',
    'Due Date: 30 October 2026', '', 'Bill To: Pacific Ledger',
    '', 'Office furniture and equipment', '', 'Subtotal AUD 1,200.00',
    'GST (10%) AUD 120.00', 'TOTAL AUD 1,320.00', '', 'SYNTHETIC TEST INVOICE - NOT PAYABLE'
]
c = canvas.Canvas(str(root / 'invoice-text.pdf'), pagesize=(595, 842))
for i, line in enumerate(lines):
    c.setFont('Helvetica-Bold' if i in (0,1,13) else 'Helvetica', 16 if i in (0,1) else 12)
    c.drawString(50, 780-i*33, line)
c.save()
image = Image.new('RGB', (1500, 1800), 'white')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 32)
for i, line in enumerate(lines): draw.text((100, 90+i*90), line, fill='black', font=font)
image.save(root/'invoice-image.png')
c = canvas.Canvas(str(root / 'invoice-scanned.pdf'), pagesize=(600,720))
c.drawImage(str(root/'invoice-image.png'),0,0,width=600,height=720)
c.save()
print('Created synthetic PDF/text, PDF/scan and PNG fixtures')
