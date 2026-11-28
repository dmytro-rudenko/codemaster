<?php
// Tournament runner for PHP.
// php php.php verify|measure <variant> <cases.json> <functionName> <iterations>
// Prints one line "CODEMASTER_RESULT <key> <value>": "passed 1", "failed <reason>" or "ns <float>".

function codemaster_report(string $key, $value): void
{
    echo "CODEMASTER_RESULT " . $key . " " . preg_replace('/\s+/', ' ', (string) $value) . "\n";
}

function codemaster_normal($value)
{
    return json_decode(json_encode($value), true);
}

try {
    [, $mode, $variantPath, $casesPath, $name, $iterations] = $argv;
    require $variantPath;
    if (!function_exists($name)) {
        codemaster_report("failed", "no function " . $name);
        exit(0);
    }
    $parsed = json_decode(file_get_contents($casesPath), true);
    $cases = array_is_list($parsed) ? $parsed : $parsed["cases"];
    if ($mode === "verify") {
        foreach ($cases as $position => $case) {
            try {
                $actual = $name(...$case["input"]);
            } catch (Throwable $error) {
                codemaster_report("failed", "case " . $position . ": threw " . $error->getMessage());
                exit(0);
            }
            if (json_encode(codemaster_normal($actual)) !== json_encode($case["expected"])) {
                codemaster_report("failed", "case " . $position . ": expected " . json_encode($case["expected"]) . " got " . json_encode($actual));
                exit(0);
            }
        }
        codemaster_report("passed", 1);
        exit(0);
    }
    $count = (int) $iterations;
    $started = hrtime(true);
    for ($position = 0; $position < $count; $position++) {
        $name(...$cases[$position % count($cases)]["input"]);
    }
    codemaster_report("ns", (hrtime(true) - $started) / $count);
} catch (Throwable $error) {
    codemaster_report("failed", $error->getMessage());
}
