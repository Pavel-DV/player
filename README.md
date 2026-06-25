### http server:

```
e:
cd E:\player
npx http-server . -S -C 192.168.4.26.pem -K 192.168.4.26-key.pem -a 0.0.0.0 -p 8443
```

### iOS debug:

1. run proxy:
    ```
    "E:\ios-webkit-debug-proxy Copy from C\1.9.1\ios_webkit_debug_proxy.exe"
    ```
2. turn off CORS
3. open https://ios-safari-debug.besties.house/

### Cert renew:
```
e:
cd E:\player
// mkcert -install   # done
mkcert 192.168.4.26 localhost 127.0.0.1
// mkcert -CAROOT   # where is the cert
```