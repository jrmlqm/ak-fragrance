const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { customerEmail, customerName, items, total, deliveryType, address } = req.body;

    const itemsHTML = items.map(item => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #F0E6D3;font-family:'Georgia',serif;font-size:16px;color:#5A4635">${item.name}</td>
        <td style="padding:12px 0;border-bottom:1px solid #F0E6D3;text-align:center;font-size:13px;color:#9A8878">×${item.qty}</td>
        <td style="padding:12px 0;border-bottom:1px solid #F0E6D3;text-align:right;font-size:13px;font-weight:500;color:#5A4635">${item.price * item.qty} €</td>
      </tr>`).join('');

    const deliveryNames = {
      standard: 'Livraison standard (3–5 jours)',
      express: 'Livraison express (24–48h)',
      relay: 'Point relais (4–6 jours)'
    };

    const deliveryCost = deliveryType === 'express' ? '9,90 €' : deliveryType === 'relay' ? '3,90 €' : 'Offerte';

    const emailHTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FAF6EF;font-family:'Jost',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EF;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <tr>
          <td style="background:#5A4635;padding:40px;text-align:center">
            <div style="font-family:'Georgia',serif;font-size:28px;font-weight:300;letter-spacing:8px;color:#FDFAF5;text-transform:uppercase">AK Fragrance</div>
            <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(240,230,211,0.6);margin-top:6px">Parfumerie de niche d'exception</div>
          </td>
        </tr>
        <tr>
          <td style="background:#FDFAF5;padding:44px 40px 32px;border-left:1px solid #F0E6D3;border-right:1px solid #F0E6D3">
            <div style="font-family:'Georgia',serif;font-size:13px;letter-spacing:4px;text-transform:uppercase;color:#B09A88;margin-bottom:12px">Confirmation de commande</div>
            <div style="font-family:'Georgia',serif;font-size:32px;font-weight:300;color:#5A4635;margin-bottom:20px">Merci ${customerName} !</div>
            <p style="font-size:13px;color:#9A8878;line-height:1.8;margin:0 0 28px">Votre commande a bien été confirmée et votre paiement validé. Nous préparons votre commande avec soin et vous enverrons un email de suivi dès l'expédition.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#FDFAF5;padding:0 40px 32px;border-left:1px solid #F0E6D3;border-right:1px solid #F0E6D3">
            <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#B09A88;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #F0E6D3">Votre commande</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${itemsHTML}
              <tr>
                <td colspan="2" style="padding:16px 0 6px;font-size:12px;color:#9A8878">${deliveryNames[deliveryType] || 'Livraison standard'}</td>
                <td style="padding:16px 0 6px;text-align:right;font-size:12px;color:#9A8878">${deliveryCost}</td>
              </tr>
              <tr>
                <td colspan="2" style="padding:14px 0;border-top:1px solid #F0E6D3;font-family:'Georgia',serif;font-size:18px;color:#5A4635">Total</td>
                <td style="padding:14px 0;border-top:1px solid #F0E6D3;text-align:right;font-family:'Georgia',serif;font-size:18px;color:#5A4635">${total} €</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#FAF6EF;padding:28px 40px;border:1px solid #F0E6D3;border-top:none">
            <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#B09A88;margin-bottom:12px">Adresse de livraison</div>
            <div style="font-size:13px;color:#5A4635;line-height:1.8">${address}</div>
          </td>
        </tr>
        <tr>
          <td style="background:#5A4635;padding:32px 40px;text-align:center">
            <div style="font-size:11px;color:rgba(240,230,211,0.6);line-height:1.8">
              Des questions ? <a href="mailto:akfragrance75@gmail.com" style="color:#F0E6D3">akfragrance75@gmail.com</a><br>
              © 2025 AK Fragrance — Île-de-France
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const resendPayload = JSON.stringify({
      from: 'AK Fragrance <contact@ak-fragrance.com>',
      to: [customerEmail],
      subject: '✓ Commande confirmée — AK Fragrance',
      html: emailHTML
    });

    await new Promise((resolve, reject) => {
      const req2 = https.request({
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(resendPayload)
        }
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(JSON.parse(data));
          else reject(new Error(`Resend error ${response.statusCode}: ${data}`));
        });
      });
      req2.on('error', reject);
      req2.write(resendPayload);
      req2.end();
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({ error: err.message });
  }
};
