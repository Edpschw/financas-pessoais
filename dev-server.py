#!/usr/bin/env python3
"""Servidor estático para desenvolvimento.

Igual a `python3 -m http.server`, com uma diferença importante: manda
`Cache-Control: no-store`. Sem esse cabeçalho o navegador aplica cache heurístico
(baseado no Last-Modified) e continua servindo uma versão antiga do app depois de
uma alteração — o que dá tela em branco ou comportamento estranho até limpar o cache
na mão.

Uso:
    python3 dev-server.py [porta]     # padrão: 8000
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Servindo em http://localhost:{port} (sem cache)")
    http.server.test(HandlerClass=NoCacheHandler, port=port, bind="127.0.0.1")
