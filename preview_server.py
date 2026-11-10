from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import argparse
p=argparse.ArgumentParser();p.add_argument('--host',default='127.0.0.1');p.add_argument('--port',type=int,default=3000);a,_=p.parse_known_args()
ThreadingHTTPServer((a.host,a.port),SimpleHTTPRequestHandler).serve_forever()
