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

Tarayicidan `http://localhost:3012` adresini acin.

## Docker ile Calistirma

### 1) Docker image build

```bash
docker build -t ocr-karsilastirma .
```

### 2) Docker container run

```bash
docker run --rm -p 3012:3012 \
	-e OCR_API_URL=http://host.docker.internal:8000/ocr \
	-e OPENAI_API_KEY=your-openai-key \
	ocr-karsilastirma
```

### 3) Docker Compose ile (onerilen)

```bash
docker compose --env-file .env.docker up --build
```

Compose iki farkli mod destekler:

- Compose icindeki OCR servisi (varsayilan):

```bash
docker compose --env-file .env.docker up --build
```

Bu modda `web` servisi `rapidocr-api` servisine Docker internal network uzerinden
`http://rapidocr-api:9005/ocr` adresiyle baglanir.

- Dis OCR servisi ile:

```bash
docker compose --env-file .env.docker.external up --build
```

Bu modda `web` container disaridaki OCR endpointine baglanir.
Linux sunucuda `host.docker.internal` kullanacaksaniz host mapping'inizin desteklendiginizden emin olun.

Disaridan OCR API test etmek isterseniz compose icindeki servis icin `http://localhost:8099/ocr` adresini kullanabilirsiniz.

Env dosyalari:

- `.env.docker`: Compose icindeki `rapidocr-api` servisine baglanan varsayilan ayarlar
- `.env.docker.external`: Docker disindaki OCR servisine baglanan ayarlar

## Notlar

- Dosyalar diske yazilmaz; Server Action icinden `multipart/form-data` ile OCR servisine gonderilir.
- OCR ve karsilastirma akisI `app/actions/process-docs.ts` icindeki Server Action ile yurutulur.
- UI tarafinda tek coklu dosya alaninda `useActionState` ve `useFormStatus` kullanilir.
