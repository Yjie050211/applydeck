import os from 'node:os';

export function listLanUrls(port, interfaces) {
  const nets = interfaces || os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of (nets[name] || [])) {
      const isV4 = net.family === 'IPv4' || net.family === 4;
      if (!isV4 || net.internal) continue;
      const address = String(net.address || '');
      if (!address || address.indexOf('169.254.') === 0) continue;
      urls.push({ iface: name, address: address, url: 'http://' + address + ':' + port });
    }
  }
  return urls;
}

export function isLanHost(host) {
  return host === '0.0.0.0' || host === '::' || host === '';
}
