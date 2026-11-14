# 移动端加密分析：库特征、密钥位置、算法识别

> 被 `competition-crypto-mobile`、`ctf-sandbox-orchestrator` 引用。
> 移动端加密题几乎都是**"找到密钥 + 找到算法 + 复现"**三步，
> 难点在密钥往往**不在静态可见处**。

## 一、常见加密库与特征

| 库 | 平台 | 静态特征 | 逆向提示 |
| --- | --- | --- | --- |
| **Java Cryptography (JCE)** | Android | `javax.crypto.Cipher`、`SecretKeySpec`、`IvParameterSpec` | hook `Cipher.getInstance` 拿算法 |
| **Conscrypt** | Android 默认 | `com.android.org.conscrypt.*`、`OpenSSLSocketImpl` | pinning 与 TLS 都在这 |
| **BoringSSL** | Android native | `SSL_CTX_*`、`EVP_*`、`CRYPTO_*` 符号 | 未剥离时符号全可见 |
| **OpenSSL** | 双平台 native | `libcrypto.so`、`EVP_CIPHER_CTX_new` | 老 app / 第三方 SDK |
| **mbedTLS** | 嵌入式/部分 SDK | `mbedtls_*` 符号 | IoT 类 app |
| **libsodium** | 第三方 | `crypto_secretbox_*`、`sodium_*` | 混淆库名但符号在 |
| **CommonCrypto** | iOS | `CCCrypt`、`CC_SHA256`、`CCKeyDerivationPBKDF` | iOS 原生首选 |
| **CryptoKit** | iOS 13+ | Swift `SymmetricKey`、`AES.GCM` | Swift 符号 `$s` |
| **白盒 AES** | 商业保护 | 巨大的查表（>10KB 表）+ 无 S-box | 表驱动，标准算法识别失败 |
| **自研/魔改** | 恶意样本 | 无标准常量 + 自定义轮数 | 只能逐行逆 |

```bash
# Android：Java 层用的是什么
grep -rn "Cipher.getInstance\|SecretKeySpec\|IvParameterSpec\|MessageDigest" ./src_out | head -20
# native 层
strings lib/arm64-v8a/lib*.so | grep -E "^SSL_|^EVP_|^CRYPTO_|mbedtls_|sodium_|CCCrypt"
nm -D lib/arm64-v8a/lib*.so 2>/dev/null | grep -E " (EVP_|AES_|HMAC_)" | head -20
```

```bash
# iOS
strings Payload/App.app/App | grep -E "CCCrypt|CC_SHA|SecKey|kSecAttr|AES"
nm Payload/App.app/App | grep -i "CCCrypt\|SecKey"
```

## 二、算法识别：常量表 + 结构双确认

| 算法 | 常量/表 | 位置 | 冲突风险 |
| --- | --- | --- | --- |
| AES | S-box `63 7c 77 7b f2 6b 6f c5` | rodata / `.data` | 白盒会用不同表 |
| AES-NI | 无表，`aesenc`/`aesdec` 指令 | 代码段 | x86 模拟器上才有 |
| DES/3DES | IP 表 + 8 个 S-box（64 项 × 8） | rodata | 老系统 |
| SM4 | S-box `d6 90 e9 fe cc e1 3d b7` | rodata | 国密 app |
| ChaCha20 | `expand 32-byte k` | rodata（字符串） | 直接 strings 可见 |
| Salsa20 | `expand 16-byte k` / `expand 32-byte k` | 同上 | 同上 |
| RC4 | 256 字节表 + 两次 swap | 栈上生成（非静态） | 静态搜不到表，搜循环 |
| MD5 | IV `0123456789abcdeffedcba9876543210`（LE 存为 `67452301...`）+ K 表 | rodata | 极常见 |
| SHA1 | IV `67452301 EFCDAB89 98BADCFE 10325476 C3D2E1F0` | rodata | — |
| SHA256 | IV `6a09e667 bb67ae85 3c6ef372 a54ff53a` | rodata | — |
| HMAC | 两个 64 字节 pad（0x36/0x5c 重复） | 栈上 | 按 ipad/opad 识别 |
| CRC32 | `0xEDB88320` 或 256 项表 | rodata | 校验而非加密 |
| Base64 | `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/` | rodata | 编码非加密 |

```bash
# 二进制常量表扫描（Android so / iOS Mach-O 通用）
python3 - <<'PY'
import sys
data = open(sys.argv[1] if len(sys.argv)>1 else "lib.so","rb").read()
sigs = {
 "AES_SBOX":  bytes.fromhex("637c777bf26b6fc53001672bfed7ab76"),
 "SM4_SBOX":  bytes.fromhex("d690e9fecce13db716b614c228fb2c05"),
 "MD5_IV":    bytes.fromhex("0123456789abcdeffedcba9876543210"),
 "SHA1_IV":   bytes.fromhex("67452301efcdab8998badcfe10325476c3d2e1f0"),
 "SHA256_IV": bytes.fromhex("6a09e667bb67ae853c6ef372a54ff53a"),
 "CRC32_POLY":bytes.fromhex("2083b8ed"),     # 0xEDB88320 LE
 "B64_TABLE": b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
}
for name, s in sigs.items():
    hits = []
    i = data.find(s)
    while i >= 0 and len(hits) < 5:
        hits.append(i); i = data.find(s, i+1)
    print(name, [hex(h) for h in hits] or "not found")
PY
```

**必须排除的假阳性**：

| 假阳性 | 怎么排除 |
| --- | --- |
| 字符串 "AES" 只是错误提示 | 看引用的函数体是否有轮函数 |
| S-box 存在但被 `aesenc` 取代 | 搜 `aesenc`/`aesdec` 指令计数 |
| 白盒 AES 用了自造表 | 标准 S-box 找不到，但有大表 + 大量查表运算 |
| 常量是"编译器填充" | 检查是否被引用（xref） |

## 三、密钥藏在哪（六种位置，按出现频率）

| 位置 | 特征 | 提取方式 |
| --- | --- | --- |
| **1. native 常量** | so 里一段字节，长度 16/24/32 | 静态搜 + 引用点 |
| **2. Java 字符串** | dex 里的 `const-string`，或字节数组 | 反编译直接看到 |
| **3. 资源文件** | `assets/`、`res/raw/`、`res/values/strings.xml` | `unzip -l` + 解密 |
| **4. 服务端下发** | 请求响应里带 key，或密钥协商 | 抓包 + hook 解析 |
| **5. 设备派生** | 由 IMEI/ANDROID_ID/序列号 hash 得出 | hook 取设备 ID → 复现派生 |
| **6. 白盒内嵌** | 算法本身就是密钥（查表即解密） | 无需提取，直接调库 |
| **7. Keychain/Keystore** | iOS Keychain / Android Keystore | 见 §五 |

```bash
# 1) native 常量：找 16/24/32 字节的可疑块
#    先看 rodata 里的高熵区域
objdump -s -j .rodata lib.so | head -60
#    或用 r2 找（按引用）
r2 -q -c "aaa; iz~key; axt @ str.*key*" lib.so
```

```javascript
// 2) Java 层：hook SecretKeySpec 构造（拿到所有 AES key）
Java.perform(function () {
  var SKS = Java.use("javax.crypto.spec.SecretKeySpec");
  SKS.$init.overload('[B', 'java.lang.String').implementation = function (k, alg) {
    console.log("[SecretKeySpec] alg=" + alg + " key=" + bytesToHex(k));
    return this.$init(k, alg);
  };
  var IvP = Java.use("javax.crypto.spec.IvParameterSpec");
  IvP.$init.overload('[B').implementation = function (iv) {
    console.log("[IvParameterSpec] iv=" + bytesToHex(iv));
    return this.$init(iv);
  };
});
```

```javascript
// 2b) 直接 hook Cipher.init（算法 + key + mode 一起拿）
Java.perform(function () {
  var Cipher = Java.use("javax.crypto.Cipher");
  Cipher.init.overload('int', 'java.security.Key').implementation = function (mode, key) {
    console.log("[Cipher.init] mode=" + mode + " alg=" + key.getAlgorithm()
                + " key=" + bytesToHex(key.getEncoded()));
    return this.init(mode, key);
  };
  // 带 IV 的重载
  Cipher.init.overload('int', 'java.security.Key', 'java.security.spec.AlgorithmParameterSpec')
    .implementation = function (mode, key, spec) {
      console.log("[Cipher.init+IV] key=" + bytesToHex(key.getEncoded())
                  + " spec=" + spec);
      return this.init(mode, key, spec);
    };
});
```

| 密钥形态 | 尺寸 | 判断 |
| --- | --- | --- |
| AES-128 | 16 字节 | 最常见 |
| AES-192 / 256 | 24 / 32 字节 | 次之 |
| DES | 8 字节 | 老 |
| 3DES | 16 或 24 字节 | 老 |
| HMAC key | 任意 | 与加密 key 常不同 |
| RSA | 模数 128/256 字节 | 公钥可静态拿 |

## 四、动态拿密钥（最可靠）

### 4.1 Android

```javascript
// 组合拳：Cipher / Mac / MessageDigest 全 hook
Java.perform(function () {
  var Cipher = Java.use("javax.crypto.Cipher");
  ["doFinal", "update"].forEach(function (m) {
    if (!Cipher[m]) return;
    Cipher[m].overloads.forEach(function (o) {
      o.implementation = function () {
        var args = Array.prototype.slice.call(arguments);
        var out = o.call(this, ...args);
        try {
          console.log("[" + m + "] in=" + hexOf(args[0]) + " out=" + hexOf(out));
        } catch (e) {}
        return out;
      };
    });
  });

  // Mac 的 key 由 init(Key) 传入，单独 hook 才能拿到
  var Mac = Java.use("javax.crypto.Mac");
  Mac.init.overload('java.security.Key').implementation = function (k) {
    console.log("[Mac.init] alg=" + k.getAlgorithm() + " key=" + bytesToHex(k.getEncoded()));
    return this.init(k);
  };
  Mac.doFinal.overload('[B').implementation = function (b) {
    var out = this.doFinal(b);
    console.log("[Mac.doFinal] in=" + bytesToHex(b) + " out=" + bytesToHex(out));
    return out;
  };
});
```

```javascript
// native 层：hook EVP_EncryptInit_ex / AES_set_encrypt_key
["EVP_EncryptInit_ex", "AES_set_encrypt_key", "EVP_DecryptInit_ex"].forEach(function (n) {
  var f = Module.findExportByName(null, n);
  if (!f) return;
  Interceptor.attach(f, {
    onEnter(args) {
      console.log("[" + n + "] args:", args[0], args[1], args[2], args[3]);
      // AES_set_encrypt_key(userKey, bits, key) → args[0] 是 key
      try { console.log(hexdump(args[0], { length: 32 })); } catch (e) {}
    }
  });
});
```

### 4.2 iOS

```javascript
// CommonCrypto：CCCrypt(op, alg, options, key, keyLen, iv, in, inLen, out, outLen)
var CCCrypt = Module.findExportByName("libcommonCrypto.dylib", "CCCrypt");
Interceptor.attach(CCCrypt, {
  onEnter(args) {
    var op = args[0].toInt32();          // 0=encrypt, 1=decrypt
    var alg = args[1].toInt32();         // 0=AES128, 1=DES, 2=3DES, 3=CAST, 4=RC4...
    var keyLen = args[4].toInt32();
    console.log("[CCCrypt] op=" + op + " alg=" + alg + " keyLen=" + keyLen);
    console.log("key: " + hexdump(args[3], { length: keyLen }));
    if (args[5] && !args[5].isNull()) console.log("iv: " + hexdump(args[5], { length: 16 }));
    this.inLen = args[7].toInt32();
    this.inBuf = args[6];
  },
  onLeave(ret) {
    console.log(hexdump(this.inBuf, { length: Math.min(this.inLen, 64) }));
  }
});
```

| CommonCrypto 常量 | 值 |
| --- | --- |
| `kCCAlgorithmAES128` | 0 |
| `kCCAlgorithmDES` | 1 |
| `kCCAlgorithm3DES` | 2 |
| `kCCAlgorithmCAST` | 3 |
| `kCCAlgorithmRC4` | 4 |
| `kCCAlgorithmRC2` | 5 |
| `kCCAlgorithmBlowfish` | 6 |

## 五、Keystore / Keychain 里的密钥

### 5.1 Android Keystore

```javascript
// hook KeyStore.getEntry（拿到 alias）
Java.perform(function () {
  var KS = Java.use("java.security.KeyStore");
  KS.getEntry.overload('java.lang.String', 'java.security.KeyStore$ProtectionParameter')
    .implementation = function (alias, prot) {
      console.log("[KeyStore.getEntry] alias=" + alias);
      var e = this.getEntry(alias, prot);
      try {
        var k = e.getKey();
        console.log("  key alg=" + k.getAlgorithm() + " encoded=" + k.getEncoded());
      } catch (err) { console.log("  (key not extractable: " + err + ")"); }
      return e;
    };
});
```

**关键认知**：Android Keystore 里的 key 通常 **`getEncoded()` 返回 null**（不可导出，
密钥在 TEE/StrongBox 里）。这种情况**无法静态提取**，只能：

- hook 使用该 key 的加密函数（拿明文/密文对，反推不了 key，但能复现加密）
- 或 hook `Cipher.doFinal` 直接拿到结果

### 5.2 iOS Keychain

```javascript
// hook SecItemCopyMatching 的结果
var Sec = Module.load("/System/Library/Frameworks/Security.framework/Security");
Interceptor.attach(Sec.findExportByName("SecItemCopyMatching"), {
  onEnter(args) { this.res = args[1]; },
  onLeave(ret) {
    if (ret.toInt32() === 0) {
      console.log("[Keychain] " + new ObjC.Object(this.res.readPointer()).toString());
    }
  }
});
```

## 六、白盒 AES 与魔改算法

| 形态 | 识别 | 处理 |
| --- | --- | --- |
| 白盒 AES（查表） | 多个 >4KB 的表 + 大量移位/查表，无标准 S-box | 无法逆出 key（key 已被编码进表）；**直接调用其函数即可** |
| 魔改轮数（如 12 轮） | 轮函数结构对但常数不同 | 复现时改轮数 |
| 魔改 S-box | 表不同但结构一致 | 提取表后按标准流程复现 |
| 加盐/自定义 padding | 输入输出长度对不上，尾部有额外字节 | 逆 padding 逻辑 |
| 双重加密 | 输出长度翻倍或嵌套 | 逐层剥离 |
| 与 hash 绑定 | 密文随输入变化但同一明文不稳定 | 找 nonce/salt 来源 |

```text
白盒 AES 的判断要点：
  □ 有 4 个或更多 256 项的 32 位表（T-boxes），总计 > 4KB
  □ 每轮是 "查表 + xor + 移位" 而不是 SubBytes/ShiftRows 的显式实现
  □ 找不到 key schedule 循环
→ 结论：密钥被编码进表，不可提取。只能"用它的函数"。
```

## 七、复现：把算法搬出来

```python
# 标准 AES-CBC 复现（拿到 key/iv 之后）
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
import binascii

key = bytes.fromhex("00112233445566778899aabbccddeeff")
iv  = bytes.fromhex("0102030405060708090a0b0c0d0e0f10")
ct  = binascii.unhexlify("...")

pt = unpad(AES.new(key, AES.MODE_CBC, iv).decrypt(ct), 16)
print(pt)

# 如果是 PKCS7 + 前置随机 IV（常见）：密文前 16 字节就是 IV
iv2, body = ct[:16], ct[16:]
print(unpad(AES.new(key, AES.MODE_CBC, iv2).decrypt(body), 16))
```

```python
# 校验复现是否正确：加密同一个明文，密文逐字节相等
mine = AES.new(key, AES.MODE_CBC, iv).encrypt(pad(b"hello", 16))
assert mine == app_ciphertext, "mismatch -> 算法/模式/padding 有一项错"
```

| 复现失败原因 | 排查 |
| --- | --- |
| 密文不匹配 | 模式错（CBC vs GCM vs CTR）、padding 错、IV 位置错 |
| 长度差 16 字节 | padding 是否包含（有的实现不 pad） |
| 前 16 字节不同 | IV 是随机的，要单独取 |
| 只有部分匹配 | 有额外 xor / 二次加密 |
| GCM 标签位置 | tag 在前还是在后（不同库不同） |

## 八、检测视角（防守方）

| 红队动作 | 信号 |
| --- | --- |
| hook Cipher/Mac | 无直接日志；但 hook 会改代码段（自校验可发现） |
| 抓包解密 | TLS 指纹变化；请求重放（时间戳/nonce 重复） |
| 提取 key 后离线解密 | 无（离线） |
| 伪造请求 | 服务端签名校验（HMAC 不匹配）→ **通常这才是真正的门槛** |
| Keystore 使用 | 设备侧有 key 使用日志（部分 OEM） |

## 九、验伤信号

| 声称 | 证据 |
| --- | --- |
| "识别出算法" | 常量表地址 + 调用它的函数 + 输入输出验证 |
| "拿到密钥" | key 字节 + 长度符合算法 + **能正确解出已知明文** |
| "复现成功" | 用提取的 key/iv 加密同一明文，密文**逐字节相等** |
| "绕过 pinning 后看到明文" | 完整 body（不是只有 header） |

**反例（看起来成功其实是假）**：

- 拿到 32 字节"key"但解密出乱码 → 那是**密文或盐**，不是 key
- 密钥长度 16 但算法是 HMAC-SHA256 → 长度对不上，拿错了
- 解密出的明文"看起来像 JSON"但字段全是乱码 → 还有一层压缩/编码
- 本地能解密但服务端拒绝 → 服务端验签用的是**另一套 key**（签名 key ≠ 加密 key）

## 十、常见坑

1. **把编码当加密**——Base64/hex 不是加密；先 `base64 -d` 看是否已明文。
2. **只 hook `doFinal` 不看 `update`**——流式加密（大文件）走 `update`，
   `doFinal` 拿到的是最后一块。
3. **Keystore key 不可导出**——`getEncoded()` 返回 `null` 是**正常**，
   不是 hook 失败。此时只能 hook 使用点。
4. **IV 随机导致每次密文不同**——不是算法错。要拿 IV 本身（常在密文前 16 字节）。
5. **HMAC key 与加密 key 不同**——用一个 key 解另一个算法必失败。
6. **白盒 AES 死磕逆 key**——不可行（key 已融进表）。直接用它。
7. **服务端才是真正的校验方**——本地解密成功 ≠ 能伪造请求；
   签名/HMAC/时间戳/nonce 往往由服务端校验。