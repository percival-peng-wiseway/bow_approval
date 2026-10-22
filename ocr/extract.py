"""Local invoice text extraction. No network calls; temporary files are removed by caller."""
import json
import base64
import io
import os
import subprocess
import sys
import warnings
from pathlib import Path

warnings.filterwarnings('ignore')
MAX_PAGES = 10
MAX_PIXELS = 25_000_000


def recognize(image, directory, index):
    from PIL import Image, ImageOps
    if image.width * image.height > MAX_PIXELS:
        raise ValueError('Image is too large. Use an image under 25 megapixels.')
    image = ImageOps.exif_transpose(image)
    if max(image.size) > 3200:
        image.thumbnail((3200, 3200))
    if image.mode in ('RGBA', 'LA'):
        background = Image.new('RGBA', image.size, 'white')
        background.alpha_composite(image.convert('RGBA'))
        image = background.convert('RGB')
    image = ImageOps.autocontrast(image.convert('L'))
    target = directory / f'page-{index}.png'
    image.save(target)
    process = subprocess.run([os.environ.get('INVOICE_TESSERACT', '/opt/homebrew/bin/tesseract'),
                              str(target), 'stdout', '-l', 'eng', '--psm', '3'],
                             capture_output=True, text=True, timeout=25)
    if process.returncode:
        raise ValueError('Could not recognise this image. Try a clearer scan.')
    return process.stdout.strip()


def extract(source, preview_only=False):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    pages = []
    previews = []
    if source.suffix == '.pdf':
        from pypdf import PdfReader
        import pypdfium2 as pdfium
        reader = PdfReader(str(source))
        if reader.is_encrypted and not reader.decrypt(''):
            raise ValueError('This PDF is password protected. Upload an unlocked copy.')
        if not 1 <= len(reader.pages) <= MAX_PAGES:
            raise ValueError('Please upload an invoice with 1 to 10 pages.')
        renderer = None
        try:
            for index, page in enumerate(reader.pages):
                text = '' if preview_only else (page.extract_text(extraction_mode='layout') or '')
                method = 'PDF text'
                # Scans sometimes contain a page number but no usable text layer.
                if not preview_only and sum(c.isalnum() for c in text) < 40:
                    renderer = renderer or pdfium.PdfDocument(str(source))
                    rendered_page = renderer[index]
                    width, height = rendered_page.get_size()
                    scale = min(2.5, 3200 / max(width, height))
                    bitmap = rendered_page.render(scale=scale)
                    text = recognize(bitmap.to_pil(), source.parent, index)
                    bitmap.close()
                    rendered_page.close()
                    method = 'OCR'
                renderer = renderer or pdfium.PdfDocument(str(source))
                preview_page = renderer[index]
                width, height = preview_page.get_size()
                bitmap = preview_page.render(scale=min(1000/width, 1400/height))
                preview = bitmap.to_pil().convert('RGB')
                encoded = io.BytesIO()
                preview.save(encoded, format='JPEG', quality=85)
                previews.append({'number': index+1, 'data': 'data:image/jpeg;base64,' + base64.b64encode(encoded.getvalue()).decode()})
                bitmap.close()
                preview_page.close()
                pages.append({'number': index + 1, 'method': method, 'text': text.strip()})
        finally:
            if renderer:
                renderer.close()
    else:
        with Image.open(source) as image:
            if image.format not in ('PNG', 'JPEG', 'WEBP'):
                raise ValueError('Use a PDF, PNG, JPG or WebP file.')
            pages.append({'number': 1, 'method': 'OCR', 'text': recognize(image, source.parent, 0)})
    text = '\n\n'.join(page['text'] for page in pages)
    if not preview_only and not text.strip():
        raise ValueError('No readable text found. Try a sharper, upright invoice scan.')
    if len(text) > 120000:
        raise ValueError('This document contains too much text. Upload the invoice pages only.')
    return {'text': text, 'pages': [{'number': p['number'], 'method': p['method']} for p in pages], 'previews': previews}


if __name__ == '__main__':
    try:
        print(json.dumps(extract(Path(sys.argv[1]), '--preview' in sys.argv[2:])))
    except Exception as error:
        safe = str(error) if isinstance(error, ValueError) else 'The document could not be read. Try exporting or scanning it again.'
        print(json.dumps({'error': safe}))
        sys.exit(1)
