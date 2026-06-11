const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: 'Champs manquants' });

    const emailHTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#FAF6EF;font-family:'Jost',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EF;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <tr>
          <td style="background:#5A4635;padding:32px 40px;text-align:center">
            <div style="font-family:'Georgia',serif;font-size:24px;font-weight:300;letter-spacing:8px;color:#FDFAF5;text-transform:uppercase">AK Fragrance</div>
            <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(240,230,211,0.6);margin-top:6px">Nouveau message</div>
          </td>
        </tr>
        <tr>
          <td style="background:#FDFAF5;padding:40px;border:1px solid #F0E6D3;border-top:none">
            <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#B09A88;margin-bottom:6px">De</div>
            <div style="font-size:15px;color:#5A4635;margin-bottom:4px">${name}</div>
            <div style="font-size:12px;color:#9A8878;margin-bottom:32px"><a href="mailto:${email}" style="color:#8A6E58">${email}</a></div>

            <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#B09A88;margin-bottom:12px">Message</div>
            <div style="font-size:13px;color:#4A3828;line-height:1.8;white-space:pre-wrap;padding:20px;background:#FAF6EF;border-left:3px solid #8A6E58">${message}</div>

            <div style="margin-top:32px;padding-top:24px;border-top:1px solid #F0E6D3;text-align:center">
              <a href="mailto:${email}" style="display:inline-block;padding:14px 32px;background:#5A4635;color:#FDFAF5;text-decoration:none;font-size:10px;letter-spacing:3px;text-transform:uppercase">Répondre</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const payload = JSON.stringify({
      from: 'AK Fragrance <contact@ak-fragrance.com>',
      to: [process.env.CONTACT_EMAIL || 'akfragrance75@gmail.com'],
      reply_to: email,
      subject: `Message de ${name} — AK Fragrance`,
      html: emailHTML
    });

    await new Promise((resolve, reject) => {
      const request = https.request({
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve();
          else reject(new Error(`Resend ${response.statusCode}: ${data}`));
        });
      });
      request.on('error', reject);
      request.write(payload);
      request.end();
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Contact error:', err);
    return res.status(500).json({ error: err.message });
  }
};
