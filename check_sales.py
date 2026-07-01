import pandas as pd

file_path = "/Users/paulobarbosa/Downloads/Gestao_perfume_v3 (5) (1) (2).xlsx"
xl = pd.ExcelFile(file_path)

print("Planilhas disponíveis:", xl.sheet_names)

for sheet in xl.sheet_names:
    if "venda" in sheet.lower():
        df = xl.parse(sheet)
        print(f"\n--- {sheet} ---")
        print(df.head())
        print(f"Total de linhas: {len(df)}")
