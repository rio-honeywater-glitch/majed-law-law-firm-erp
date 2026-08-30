import fitz
import os

pdf_path = "attached_assets/عقد_اتعاب_الراجحي_قضية_الخضيري_-_4772935070_اخلاء_عقار_1784120216691.pdf"
doc = fitz.open(pdf_path)

print(f"Pages: {doc.page_count}")
print("="*80)

for i, page in enumerate(doc):
    print(f"\n===== PAGE {i+1} =====")
    text = page.get_text("text")
    print(text)
    
    # Render to image
    mat = fitz.Matrix(2.0, 2.0)
    pix = page.get_pixmap(matrix=mat)
    out_path = f".agents/outputs/contract_page_{i+1}.png"
    pix.save(out_path)
    print(f"[Saved image: {out_path}]")

doc.close()
print("\n===== DONE =====")
