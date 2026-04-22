# OCR Belge Karsilastirma Uygulamasi

Bu proje, harici bir FastAPI OCR servisi kullanarak asagidaki belgelerde OCR yapar:

- Ruhsat / Proforma
- Arac Uygunluk Belgesi
- Ehliyet

Sistem tek seferde yuklenen PDF ve resim dosyalarini sayfa bazinda analiz eder,
belge turunu otomatik tespit eder ve kritik alanlari metin olarak dondurur.

Desteklenen senaryolar:

- Ehliyet on/arka iki ayri gorsel
- Ehliyet on-arka tek kare gorsel
- Ehliyet iki sayfali PDF
- Uygunluk belgesi iki ayri gorsel
- Uygunluk belgesi tek veya cok sayfali PDF

Su alanlar cikartilir:

- Ehliyetten: Isim Soyisim, TCKN, arka sayfa kodlari
- Ruhsattan: Plaka, Sasi No, Motor No, Ruhsat Seri No, Fiili Kutle
- Uygunluk belgesinden: Yurur Vaziyette Kutle

## Kurulum

```bash
npm install
```

## .env.local Ayarlari

Proje kokune `.env.local` dosyasi olusturun.

FastAPI OCR endpoint adresini tanimlayin:

```env
OCR_API_URL=http://127.0.0.1:8000/ocr
```

## Calistirma

```bash
npm run dev
```

Tarayicidan `http://localhost:3000` adresini acin.

## Notlar

- Dosyalar diske yazilmaz; Server Action icinden `multipart/form-data` ile OCR servisine gonderilir.
- OCR ve karsilastirma akisI `app/actions/process-docs.ts` icindeki Server Action ile yurutulur.
- UI tarafinda tek coklu dosya alaninda `useActionState` ve `useFormStatus` kullanilir.
