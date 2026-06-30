# GPR Data Formats

## Supported (planned)
| Format | Extension | Manufacturer | Parser Library |
|--------|-----------|--------------|----------------|
| GSSI   | .DZT      | GSSI         | readgssi       |
| Mala   | .dt2      | Mala         | gprpy          |
| Mala   | .rd3      | Mala         | gprpy          |
| SEG-Y  | .sgy/.segy| Standard     | segyio         |
| CSV    | .csv      | Any export   | Papa Parse     |

## B-scan Structure
- X axis: trace number (horizontal distance along survey line)
- Y axis: two-way travel time (nanoseconds) → converted to depth (metres)
- Value: amplitude of reflected EM signal

## Depth Conversion
depth (m) = (travel_time_ns × velocity_m_per_ns) / 2

Default soil velocity: 0.1 m/ns (dry soil)
Wet/tropical soil: 0.06–0.08 m/ns (adjustable in Settings)
