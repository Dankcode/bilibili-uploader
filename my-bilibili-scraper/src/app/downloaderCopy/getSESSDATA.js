import { cookies } from 'next/headers';

export default function getCookie(req, res) {
  const parsedCookies = cookies.parse(req || '');
  const SESSDATA = parsedCookies.SESSDATA;

  if (SESSDATA) {
    res.status(200).json({ SESSDATA });
  } else {
    res.status(400).json({ error: 'SESSDATA cookie not found' });
  }
}